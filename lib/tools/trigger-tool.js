"use strict";

/**
 * The StatesTool class
 * This class is used to handle the trigger tool
 */
class TriggerTool {
    /**
     * Constructor for the TriggerTool
     *
     * @param adapter - The adapter instance
     */
    constructor(adapter) {
        this.adapter = adapter;
        this.adapter.log.debug(`Created new TriggerTool`);

        this.name = "TriggerTool";

        this.temperature = 0.2;
        this.max_tokens = 1000;

        this.response_format = `{
			"reasoning": "${this.adapter.I18n.translate("trigger_chain_of_thought")}",
			"noticeToAssistant": "${this.adapter.I18n.translate("trigger_notice_to_assistant")}",
			"createTriggers": [{"objectId": "${this.adapter.I18n.translate("trigger_object_id")}", "condition": {"operator": "${this.adapter.I18n.translate("trigger_condition_operator")}", "value": "ConditionValue"}, "onlyOnStateValueChange": true/false, "executeOnlyOnce": true/false, "instruction": "${this.adapter.I18n.translate("trigger_condition_instruction")}"}],
			"deleteTriggers": ["${this.adapter.I18n.translate("trigger_delete_id")}"]
		}`;

        this.system_prompt = `
			${this.adapter.I18n.translate("trigger_prompt_1")}
			${this.adapter.I18n.translate("trigger_prompt_2")}

			${this.adapter.I18n.translate("trigger_prompt_3")} ${this.response_format}
		`;

        this.tool_message = `
			${this.adapter.I18n.translate("trigger_current_time")} ${new Date().toLocaleString()}
			${this.adapter.I18n.translate("trigger_created")} ###TRIGGERS### 
			${this.adapter.I18n.translate("trigger_instruction")} "###PROMPT###".
			${this.adapter.I18n.translate("trigger_available_datapoints")} ###ENDPOINTS###
			${this.adapter.I18n.translate("trigger_answer")}
		`;

        this.prompt = null;
        this.triggers = [];
        this.oldStates = {};

        this.initTriggers();
    }

    /**
     * Check if a string is a number and return the result
     *
     * @param str - The string to check
     * @returns - The result of the check
     */
    isNumber(str) {
        const num = Number(str);
        return Number.isFinite(num);
    }

    /**
     * Check if a triggered endpoint has changed and trigger the tool
     *
     * @param id - The id of the endpoint
     * @param stateValue - The value of the endpoint
     * @returns - The result of the check
     */
    async triggerCheck(id, stateValue) {
        for (const trigger of this.triggers) {
            if (trigger.objectId === id) {
                this.adapter.log.debug(`${this.name}: Checking trigger for ${trigger.objectId}`);
                this.adapter.log.debug(`${this.name}: Old state for ${trigger.objectId} is ${this.oldStates[id]}`);
                this.adapter.log.debug(`${this.name}: New state for ${trigger.objectId} is ${stateValue}`);
                this.adapter.log.debug(
                    `${this.name}: Only on state value change for ${trigger.objectId} is ${trigger.onlyOnStateValueChange}`,
                );
                if (trigger.onlyOnStateValueChange && this.oldStates[id] === stateValue) {
                    this.adapter.log.debug(`${this.name}: No change for ${trigger.objectId}`);
                    return false;
                }
                this.oldStates[id] = stateValue;
                if (trigger.condition && trigger.condition.operator && trigger.condition.value) {
                    if (this.compare(stateValue, trigger.condition.operator, trigger.condition.value) === null) {
                        this.adapter.log.warn(
                            `${this.name}: Invalid operator ${trigger.condition.operator} or value ${trigger.condition.value} for ${trigger.objectId}`,
                        );
                        return false;
                    }

                    if (this.isNumber(trigger.condition.value)) {
                        this.adapter.log.debug(`${this.name}: Converting value to number for ${trigger.objectId}`);
                        trigger.condition.value = Number(trigger.condition.value);
                    }

                    if (trigger.condition.value == "true" || trigger.condition.value == "True") {
                        this.adapter.log.debug(
                            `${this.name}: Converting value to boolean true for ${trigger.objectId}`,
                        );
                        trigger.condition.value = true;
                    } else if (trigger.condition.value == "false" || trigger.condition.value == "False") {
                        this.adapter.log.debug(
                            `${this.name}: Converting value to boolean false for ${trigger.objectId}`,
                        );
                        trigger.condition.value = false;
                    }

                    if (this.compare(stateValue, trigger.condition.operator, trigger.condition.value)) {
                        this.adapter.log.info(
                            `${this.name}: Triggered for ${trigger.objectId} with condition ${trigger.condition.operator} ${trigger.condition.value}`,
                        );
                        const executionData = {
                            type: "triggerWakeUpOnStateChange",
                            tool: this.name,
                            prompt: trigger.instruction,
                            noticeToAssistant: this.adapter.I18n.translate(
                                "trigger_execute_by_condition",
                                trigger.objectId,
                                trigger.condition.operator,
                                trigger.condition.value,
                            ),
                            result: this.adapter.I18n.translate("trigger_current_value") + stateValue,
                        };
                        if (trigger.executeOnlyOnce) {
                            this.adapter.log.debug(
                                `${this.name}: Deleting trigger for ${trigger.objectId} with executeOnlyOnce`,
                            );
                            await this.deleteTrigger(trigger.id);
                        }
                        this.adapter.startAssistantRequest(JSON.stringify(executionData));
                    } else {
                        this.adapter.log.debug(
                            `${this.name}: Not triggered for ${trigger.objectId} with condition ${trigger.condition.operator} ${trigger.condition.value}`,
                        );
                    }
                } else {
                    this.adapter.log.info(`${this.name}: Triggered for ${trigger.objectId} without condition`);
                    const executionData = {
                        tool: this.name,
                        prompt: trigger.instruction,
                        noticeToAssistant: this.adapter.I18n.translate("trigger_execute", trigger.objectId),
                        result: this.adapter.I18n.translate("trigger_current_value") + stateValue,
                    };
                    if (trigger.executeOnlyOnce) {
                        this.adapter.log.debug(
                            `${this.name}: Deleting trigger for ${trigger.objectId} with executeOnlyOnce`,
                        );
                        await this.deleteTrigger(trigger.id);
                    }
                    this.adapter.startAssistantRequest(JSON.stringify(executionData));
                }
            }
        }
    }

    /**
     * Compare two values with an operator
     *
     * @param post - The first value
     * @param operator - The operator
     * @param value - The second value
     * @returns - The result of the comparison
     */
    compare(post, operator, value) {
        switch (operator) {
            case ">":
                return post > value;
            case "<":
                return post < value;
            case ">=":
                return post >= value;
            case "<=":
                return post <= value;
            case "==":
                return post == value;
            case "!=":
                return post != value;
            case "===":
                return post === value;
            case "!==":
                return post !== value;
            default:
                return null;
        }
    }

    /**
     * Initialize the triggers for the tool
     *
     * @returns - The result of the initialization
     */
    async initTriggers() {
        this.adapter.log.debug(`${this.name}: Initializing triggers for ${this.name}`);
        for (const trigger of this.triggers) {
            this.adapter.unsubscribeForeignStates(trigger.objectId);
        }
        this.triggers = [];
        const triggers = await this.getTriggers();
        for (const trigger of triggers) {
            try {
                this.createTrigger(
                    trigger.id,
                    trigger.objectId,
                    trigger.condition,
                    trigger.instruction,
                    trigger.onlyOnStateValueChange,
                    trigger.executeOnlyOnce,
                );
            } catch (e) {
                this.adapter.log.error(`${this.name}: Error while parsing trigger data for ${trigger.id}: ${e}`);
            }
        }
    }

    /**
     * Get all triggers for the tool
     *
     * @returns - The triggers for the tool
     */
    async getTriggers() {
        this.adapter.log.debug(`${this.name}: Getting triggers for ${this.name}`);
        const allObjects = await this.adapter.getAdapterObjectsAsync();
        const triggers = [];
        for (const id in allObjects) {
            if (id.includes("Triggers.")) {
                const state = await this.adapter.getStateAsync(id);
                try {
                    const triggerData = JSON.parse(this.adapter.jsonRepair(state.val));
                    if (triggerData && triggerData.objectId && triggerData.instruction) {
                        this.adapter.log.debug(
                            `${this.name}: Found trigger for ${id} with objectId ${triggerData.objectId} and instruction ${triggerData.instruction}`,
                        );
                        triggers.push({
                            id: id,
                            objectId: triggerData.objectId,
                            condition: triggerData.condition,
                            instruction: triggerData.instruction,
                            onlyOnStateValueChange: triggerData.onlyOnStateValueChange,
                            executeOnlyOnce: triggerData.executeOnlyOnce,
                        });
                    }
                } catch (e) {
                    this.adapter.log.error(`${this.name}: Error while parsing trigger data for ${id}: ${e}`);
                }
            }
        }
        return triggers;
    }

    /**
     * Create a trigger for the tool
     *
     * @param triggerId - The id of the trigger
     * @param objectId - The id of the object
     * @param condition - The condition for the trigger
     * @param instruction - The instruction for the trigger
     * @param onlyOnStateValueChange - The state value change for the trigger
     * @param executeOnlyOnce - If the trigger should only execute once
     * @returns - The result of the creation
     */
    async createTrigger(triggerId, objectId, condition, instruction, onlyOnStateValueChange, executeOnlyOnce) {
        if (!triggerId || !objectId || !instruction) {
            return this.adapter.log.warn(
                `Cannot create trigger for ${triggerId} with objectId ${objectId} and instruction ${instruction}`,
            );
        }
        this.adapter.log.debug(
            `${this.name}: Creating trigger for ${triggerId} with objectId ${objectId} and instruction ${instruction}`,
        );
        this.adapter.log.debug(
            `${this.name}: Trigger Data: ObjectId${objectId} Condition: ${condition} Instruction: ${
                instruction
            } OnlyOnStateValueChange: ${onlyOnStateValueChange} ExecuteOnlyOnce: ${executeOnlyOnce}`,
        );
        this.adapter.log.debug(`${this.name}: Subscribing to state changes for ${objectId}`);
        this.adapter.subscribeForeignStates(objectId);
        this.triggers.push({
            id: triggerId,
            objectId: objectId,
            condition: condition,
            instruction: instruction,
            onlyOnStateValueChange: onlyOnStateValueChange,
            executeOnlyOnce: executeOnlyOnce,
        });
        const oldState = await this.adapter.getForeignStateAsync(objectId);
        this.adapter.log.debug(`${this.name}: Saving old state for ${objectId} to ${oldState.val}`);
        this.oldStates[objectId] = oldState.val;
    }

    /**
     * Delete a trigger for the tool
     *
     * @param triggerId - The id of the trigger
     * @returns - The result of the deletion
     */
    async deleteTrigger(triggerId) {
        this.adapter.log.debug(`${this.name}: Deleting trigger ${triggerId}`);
        try {
            await this.adapter.delObjectAsync(triggerId);
            this.initTriggers();
        } catch (e) {
            this.adapter.log.error(`${this.name}: Error while deleting trigger for ${triggerId}: ${e}`);
        }
    }

    /**
     * Request data for the tool
     *
     * @param prompt - The prompt for the request
     * @returns - The result of the request
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
     * Construct the tool message
     *
     * @param prompt - The prompt for the tool
     * @returns - The constructed message
     */
    async constructToolMessage(prompt) {
        let message = this.tool_message;
        const triggers = await this.getTriggers();
        message = message.replace("###TRIGGERS###", JSON.stringify(triggers));
        message = message.replace("###ENDPOINTS###", await this.adapter.getAvailableEndpointsStructure());
        message = message.replace("###PROMPT###", prompt);
        return message;
    }

    /**
     * Handle the response from the tool
     *
     * @param modelResponse - The response from the tool
     * @returns - The response for the assistant
     */
    async handleResponse(modelResponse) {
        this.adapter.log.debug(`${this.name}: Handling response for ${this.name}`);
        try {
            const responseData = JSON.parse(this.adapter.jsonRepair(modelResponse.replace(/(\r\n|\n|\t|\r)/gm, "")));
            const createdTriggers = [];
            const deletedTriggers = [];
            if (
                responseData.createTriggers &&
                Array.isArray(responseData.createTriggers) &&
                responseData.createTriggers.length > 0
            ) {
                for (const trigger of responseData.createTriggers) {
                    const id = `Triggers.${Date.now()}`;
                    await this.adapter.setObjectAsync(id, {
                        type: "state",
                        common: {
                            name: `Trigger for ${this.name}`,
                            type: "string",
                            role: "state",
                            read: true,
                            write: true,
                        },
                    });
                    const triggerString = JSON.stringify({
                        objectId: trigger.objectId,
                        condition: trigger.condition,
                        instruction: trigger.instruction,
                        onlyOnStateValueChange: trigger.onlyOnStateValueChange,
                        executeOnlyOnce: trigger.executeOnlyOnce,
                    });
                    await this.adapter.setStateAsync(id, triggerString);
                    this.createTrigger(
                        id,
                        trigger.objectId,
                        trigger.condition,
                        trigger.instruction,
                        trigger.onlyOnStateValueChange,
                        trigger.executeOnlyOnce,
                    );
                    createdTriggers.push({
                        objectId: trigger.objectId,
                        condition: trigger.condition,
                        instruction: trigger.instruction,
                        onlyOnStateValueChange: trigger.onlyOnStateValueChange,
                        executeOnlyOnce: trigger.executeOnlyOnce,
                    });
                }
            }
            if (
                responseData.deleteTriggers &&
                Array.isArray(responseData.deleteTriggers) &&
                responseData.deleteTriggers.length > 0
            ) {
                for (const id of responseData.deleteTriggers) {
                    await this.deleteTrigger(id);
                    deletedTriggers.push(id);
                }
            }
            const toolResponse = {
                type: "toolReponse",
                tool: this.name,
                reasoning: responseData.reasoning,
                noticeToAssistant: responseData.noticeToAssistant,
                result: { createdTriggers: createdTriggers, deletedTriggers: deletedTriggers },
            };
            return toolResponse;
        } catch (error) {
            this.adapter.log.error(`${this.name}: Error while parsing response for ${this.name}: ${error}`);
            return null;
        }
    }
}

module.exports = TriggerTool;
