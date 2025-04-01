"use strict";

/**
 * The StatesTool class
 * This class is used to handle the states tool
 */
class StatesTool {
    /**
     * Constructor for the StatesTool
     *
     * @param adapter - The adapter instance
     */
    constructor(adapter) {
        this.adapter = adapter;
        this.adapter.log.debug(`Created new StatesTool`);

        this.name = "StatesTool";

        this.temperature = 0.2;
        this.max_tokens = 1000;

        this.response_format = `{
			"reasoning": "${this.adapter.I18n.translate("get_states_chain_of_thought")}",
			"noticeToAssistant": "${this.adapter.I18n.translate("get_states_notice_to_assistant")}",
			"set-states": [{"name": "${this.adapter.I18n.translate("get_states_name_of_device")}", "id": "${this.adapter.I18n.translate("get_states_iobroker_id")}", "value": "${this.adapter.I18n.translate("get_states_new_value")}"}],
			"get-states": [{"name": "${this.adapter.I18n.translate("get_states_name_of_device")}", "id": "${this.adapter.I18n.translate("get_states_iobroker_id")}"}],
		}`;

        this.system_prompt = `
			${this.adapter.I18n.translate("get_states_prompt_1")}
			${this.adapter.I18n.translate("get_states_prompt_2")}
			${this.adapter.I18n.translate("get_states_prompt_3")} ${this.response_format}
		`;

        this.tool_message = `
			${this.adapter.I18n.translate("get_states_datapoint_select")} "###PROMPT###". 
			${this.adapter.I18n.translate("get_states_available_datapoints")} ###ENDPOINTS###
			${this.adapter.I18n.translate("get_states_answer")}
		`;

        this.prompt = null;
    }

    /**
     * Start a request to the  states tool
     *
     * @param prompt - The prompt for the tool
     * @returns - The response from the tool
     */
    async request(prompt) {
        this.adapter.log.debug(`Request data for ${this.name} with prompt: ${prompt}`);
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
        message = message.replace("###PROMPT###", prompt);
        message = message.replace("###ENDPOINTS###", await this.adapter.getAvailableEndpointsStructure());
        return message;
    }

    /**
     * Handle the response from the tool
     *
     * @param modelResponse - The response from the tool
     * @returns - The response for the assistant
     */
    async handleResponse(modelResponse) {
        this.adapter.log.debug(`Handling response for ${this.name}`);
        try {
            const responseData = JSON.parse(this.adapter.jsonRepair(modelResponse));
            const result = {
                setStates: [],
                getStates: [],
            };

            if (
                responseData["set-states"] &&
                Array.isArray(responseData["set-states"]) &&
                responseData["set-states"].length > 0
            ) {
                result.setStates = await this.setStatesForDatapoints(responseData["set-states"]);
            }

            if (
                responseData["get-states"] &&
                Array.isArray(responseData["get-states"]) &&
                responseData["get-states"].length > 0
            ) {
                result.getStates = await this.getStatesForDatapoints(responseData["get-states"]);
            }

            const toolResponse = {
                type: "toolResponse",
                tool: this.name,
                reasoning: responseData.reasoning,
                noticeToAssistant: responseData.noticeToAssistant,
                result: result,
            };
            return toolResponse;
        } catch (error) {
            this.adapter.log.error(`Error while parsing response for ${this.name}: ${error}`);
            return null;
        }
    }

    /**
     * Set the states for the given datapoints
     *
     * @param datapoints - The datapoints to set the states for
     * @returns - The states for the datapoints
     */
    async setStatesForDatapoints(datapoints) {
        this.adapter.log.debug(`Setting states for datapoints for ${this.name}`);
        const states = [];
        for (const datapoint of datapoints) {
            this.adapter.log.debug(`Setting state for ${datapoint.id} to ${datapoint.value}`);

            await this.adapter.setForeignStateAsync(datapoint.id, { val: datapoint.value, ack: false });

            const state = await this.adapter.getForeignStateAsync(datapoint.id);
            const object = await this.adapter.getForeignObjectAsync(datapoint.id);

            let unit = "";
            if (object && object.common && object.common.unit) {
                unit = object.common.unit;
            }

            if (state) {
                const last_change = new Date(state.lc);
                const last_change_string = last_change.toLocaleString("de-DE", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                });

                const last_update = new Date(state.ts);
                const last_update_string = last_update.toLocaleString("de-DE", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                });

                states.push({
                    name: datapoint.name,
                    id: datapoint.id,
                    value: state.val,
                    type: object.common.type,
                    unit: unit,
                    last_change: last_change_string,
                    last_update: last_update_string,
                });
            }
        }
        return states;
    }

    /**
     * Get the states for the given datapoints
     *
     * @param datapoints - The datapoints to get the states for
     * @returns - The states for the datapoints
     */
    async getStatesForDatapoints(datapoints) {
        this.adapter.log.debug(`Getting states from datapoints for ${this.name}`);
        const states = [];
        for (const datapoint of datapoints) {
            this.adapter.log.debug(`Getting current state for ${datapoint.id}`);

            const state = await this.adapter.getForeignStateAsync(datapoint.id);
            const object = await this.adapter.getForeignObjectAsync(datapoint.id);

            let unit = "";
            if (object && object.common && object.common.unit) {
                unit = object.common.unit;
            }

            if (state) {
                const last_change = new Date(state.lc);
                const last_change_string = last_change.toLocaleString("de-DE", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                });

                const last_update = new Date(state.ts);
                const last_update_string = last_update.toLocaleString("de-DE", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                });

                states.push({
                    name: datapoint.name,
                    id: datapoint.id,
                    value: state.val,
                    type: object.common.type,
                    unit: unit,
                    last_change: last_change_string,
                    last_update: last_update_string,
                });
            }
        }
        return states;
    }
}

module.exports = StatesTool;
