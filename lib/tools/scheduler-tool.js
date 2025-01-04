"use strict";

const schedule = require("node-schedule");

class SchedulerTool {
    /**
     * @param adapter - The adapter instance
     */
    constructor(adapter) {
        this.adapter = adapter;
        this.adapter.log.debug(`Created new SchedulerTool`);

        this.name = "SchedulerTool";

        this.temperature = 0.2;
        this.max_tokens = 1000;

        this.response_format = `{
			"reasoning": "${this.adapter.I18n.translate("scheduler_chain_of_thought")}",
			"noticeToAssistant": "${this.adapter.I18n.translate("scheduler_notice_to_assistant")}",
			"createTimeouts": [{"timeoutSeconds": "${this.adapter.I18n.translate("scheduler_timeout_seconds_till_execution")}", "instruction": "${this.adapter.I18n.translate("scheduler_timeout_instruction")}"}],
			"createCronjobs": [{"cronExpression": "${this.adapter.I18n.translate("scheduler_cronjob_definition")}", "instruction": "${this.adapter.I18n.translate("scheduler_cronjob_instruction")}"}],
			"deleteCronjobs": ["${this.adapter.I18n.translate("scheduler_delete_id")}"]
		}`;

        this.system_prompt = `
			${this.adapter.I18n.translate("scheduler_prompt_1")}
			${this.adapter.I18n.translate("scheduler_prompt_2")}

			${this.adapter.I18n.translate("scheduler_prompt_3")} ${this.response_format}
		`;

        this.tool_message = `
			${this.adapter.I18n.translate("scheduler_current_time")} ###TIME###
			${this.adapter.I18n.translate("scheduler_created")} ###CRONJOBS###
			${this.adapter.I18n.translate("scheduler_instruction")} "###PROMPT###".
			${this.adapter.I18n.translate("scheduler_answer")}
		`;

        this.prompt = null;
        this.cronJobs = [];

        this.initCronJobs();
    }

    /**
     *
     */
    async initCronJobs() {
        this.adapter.log.debug(`${this.name}: Initializing cron jobs for ${this.name}`);
        for (const job in this.cronJobs) {
            schedule.cancelJob(job);
        }
        this.cronJobs = [];
        const cronjobs = await this.getCronjobs();
        for (const job of cronjobs) {
            try {
                this.createCronJob(job.id, job.cron, job.instruction);
            } catch (e) {
                this.adapter.log.error(`${this.name}: Error while parsing cron job data for ${job.id}: ${e}`);
            }
        }
    }

    /**
     *
     */
    async getCronjobs() {
        this.adapter.log.debug(`${this.name}: Getting cron jobs for ${this.name}`);
        const allObjects = await this.adapter.getAdapterObjectsAsync();
        const cronjobs = [];
        for (const id in allObjects) {
            if (id.includes("Cronjobs.")) {
                const state = await this.adapter.getStateAsync(id);
                try {
                    const cronData = JSON.parse(this.adapter.jsonRepair(state.val));
                    if (cronData && cronData.cron && cronData.instruction) {
                        this.adapter.log.debug(
                            `${this.name}: Found cron job for ${id} with cron ${cronData.cron} and instruction ${cronData.instruction}`,
                        );
                        cronjobs.push({ id: id, cron: cronData.cron, instruction: cronData.instruction });
                    }
                } catch (e) {
                    this.adapter.log.error(`${this.name}: Error while parsing cron job data for ${id}: ${e}`);
                }
            }
        }
        return cronjobs;
    }

    /**
     *
     */
    createCronJob(objectId, cronExpression, instruction) {
        if (!objectId || !cronExpression || !instruction) {
            return this.adapter.log.warn(
                `Cannot create cron job for ${objectId} with expression ${cronExpression} and instruction ${instruction}`,
            );
        }
        this.adapter.log.debug(
            `${this.name}: Creating cronjob for ${objectId} with expression ${cronExpression} and instruction ${instruction}`,
        );
        const job = schedule.scheduleJob(cronExpression, async () => {
            this.adapter.log.info(`${this.name}: Executing cron job ${objectId} with instruction ${instruction}`);
            const cronExecutionData = {
                type: "wakeUpFromCronjob",
                tool: this.name,
                prompt: instruction,
                noticeToAssistant: this.adapter.I18n.translate("scheduler_execute", cronExpression),
                result: this.adapter.I18n.translate("scheduler_current_time") + new Date().toLocaleString(),
            };
            this.adapter.startAssistantRequest(JSON.stringify(cronExecutionData));
        });
        this.cronJobs.push({ objectId, job });
    }

    /**
     *
     */
    async deleteCronjob(objectId) {
        this.adapter.log.debug(`${this.name}: Deleting cron job for ${objectId}`);
        try {
            await this.adapter.delObjectAsync(objectId);
            this.initCronJobs();
        } catch (e) {
            this.adapter.log.error(`${this.name}: Error while deleting cron job for ${objectId}: ${e}`);
        }
    }

    /**
     *
     */
    async request(prompt) {
        this.adapter.log.debug(`${this.name}: Request data for ${this.name} with prompt: ${prompt}`);
        const modelResponse = await this.adapter.startModelRequest(
            [{ role: "user", content: await this.constructToolMessage(prompt) }],
            this.system_prompt.replace(/(\r\n|\n|\t|\r)/gm, ""),
            this.max_tokens,
            this.temperature,
        );
        const toolResponse = await this.handleResponse(modelResponse.text);
        return toolResponse;
    }

    /**
     *
     */
    async constructToolMessage(prompt) {
        let message = this.tool_message;
        const cronjobs = await this.getCronjobs();
        message = message.replace("###CRONJOBS###", JSON.stringify(cronjobs));
        message = message.replace("###PROMPT###", prompt);
        message = message.replace("###TIME###", new Date().toLocaleString());
        return message;
    }

    /**
     *
     */
    async handleResponse(modelResponse) {
        this.adapter.log.debug(`${this.name}: Handling response for ${this.name}`);
        try {
            const responseData = JSON.parse(this.adapter.jsonRepair(modelResponse.replace(/(\r\n|\n|\t|\r)/gm, "")));
            const createdCronjobs = [];
            const deletedCronjobs = [];
            const createdTimeouts = [];
            if (
                responseData.createCronjobs &&
                Array.isArray(responseData.createCronjobs) &&
                responseData.createCronjobs.length > 0
            ) {
                for (const cronjob of responseData.createCronjobs) {
                    const id = `Cronjobs.${Date.now()}`;
                    await this.adapter.setObjectAsync(id, {
                        type: "state",
                        common: {
                            name: `Cron job for ${this.name}`,
                            type: "string",
                            role: "state",
                            read: true,
                            write: true,
                        },
                    });
                    const cronjobString = JSON.stringify({
                        cron: cronjob.cronExpression,
                        instruction: cronjob.instruction,
                    });
                    await this.adapter.setStateAsync(id, cronjobString);
                    this.createCronJob(id, cronjob.cronExpression, cronjob.instruction);
                    createdCronjobs.push({ cronExpression: cronjob.cronExpression, instruction: cronjob.instruction });
                }
            }
            if (
                responseData.createTimeouts &&
                Array.isArray(responseData.createTimeouts) &&
                responseData.createTimeouts.length > 0
            ) {
                for (const timeout of responseData.createTimeouts) {
                    setTimeout(
                        () => {
                            const timeoutExecutionData = {
                                type: "wakeUpFromTimeout",
                                tool: "SchedulerTool",
                                prompt: timeout.instruction,
                                noticeToAssistant: this.adapter.I18n.translate(
                                    "scheduler_execute_timeout",
                                    timeout.timeoutSeconds,
                                ),
                                result:
                                    this.adapter.I18n.translate("scheduler_current_time") + new Date().toLocaleString(),
                            };
                            this.adapter.startAssistantRequest(JSON.stringify(timeoutExecutionData));
                        },
                        timeout.timeoutSeconds * 1000,
                        timeout,
                    );
                    createdTimeouts.push({ timeoutSeconds: timeout.timeoutSeconds, instruction: timeout.instruction });
                }
            }
            if (
                responseData.deleteCronjobs &&
                Array.isArray(responseData.deleteCronjobs) &&
                responseData.deleteCronjobs.length > 0
            ) {
                for (const id of responseData.deleteCronjobs) {
                    await this.deleteCronjob(id);
                    deletedCronjobs.push(id);
                }
            }
            const toolResponse = {
                type: "toolReponse",
                tool: this.name,
                reasoning: responseData.reasoning,
                noticeToAssistant: responseData.noticeToAssistant,
                result: {
                    createdCronjobs: createdCronjobs,
                    deletedCronjobs: deletedCronjobs,
                    createdTimeouts: createdTimeouts,
                },
            };
            return toolResponse;
        } catch (error) {
            this.adapter.log.error(`${this.name}: Error while parsing response for ${this.name}: ${error}`);
            return null;
        }
    }
}

module.exports = SchedulerTool;
