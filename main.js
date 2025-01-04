"use strict";

/*
 * Created with @iobroker/create-adapter v2.6.5
 */
const utils = require("@iobroker/adapter-core");
const I18n = require("@iobroker/i18n");
const { jsonrepair } = require("jsonrepair");

// Providers
const AnthropicAiProvider = require("./lib/providers/anthropic-ai-provider");
const OpenAiProvider = require("./lib/providers/openai-ai-provider");
const PerplexityAiProvider = require("./lib/providers/perplexity-ai-provider");
const OpenRouterAiProvider = require("./lib/providers/openrouter-ai-provider");
const CustomAiProvider = require("./lib/providers/custom-ai-provider");

// Tools
const StatesTool = require("./lib/tools/states-tool");
const SchedulerTool = require("./lib/tools/scheduler-tool");
const TriggerTool = require("./lib/tools/trigger-tool");

class AiAssistant extends utils.Adapter {
    /**
     * @param [options] - The options for the adapter instance.
     */
    constructor(options) {
        super({
            ...options,
            name: "ai-assistant",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.provider = null;
        this.timeouts = [];
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        if (!this.config.assistant_language) {
            this.config.assistant_language = "en";
        }
        await I18n.init(__dirname, this.config.assistant_language);
        this.I18n = I18n;
        this.jsonRepair = jsonrepair;

        this.scheduler = new SchedulerTool(this);
        this.trigger = new TriggerTool(this);

        this.log.debug(await this.getAvailableEndpointsStructure());

        const models = await this.getAvailableModels();
        if (models.length == 0) {
            this.log.error("No Models set, cant start adapter!");
            return;
        }

        if (models.filter(model => model.value == this.config.assistant_model).length == 0) {
            this.log.error(`Model ${this.config.assistant_model} not found in available models, cant start adapter!`);
            return;
        }

        if (!this.config.assistant_model || this.config.assistant_model == "") {
            this.log.error("No model set for assistant, cant start adapter!");
            return;
        }

        this.provider = await this.getModelProvider(this.config.assistant_model);
        if (!this.provider) {
            this.log.error(`No provider set for model ${this.config.assistant_model}, cant start adapter!`);
            return;
        }

        this.log.info(
            `Starting adapter with provider: ${this.provider.name} and model: ${this.config.assistant_model}`,
        );

        // Create Models and Assistant objects
        await this.setObjectAsync("Models", {
            type: "device",
            common: {
                name: "AI Models",
                desc: "Statistics and Data for used AI Models",
            },
            native: {},
        });

        await this.setObjectAsync("Assistant", {
            type: "device",
            common: {
                name: "Assistant",
                desc: "Interact with your Assistant",
            },
            native: {},
        });

        await this.setObjectAsync("Cronjobs", {
            type: "device",
            common: {
                name: "Cronjobs",
                desc: "Cronjobs created by Assistant",
            },
            native: {},
        });

        await this.setObjectAsync("Triggers", {
            type: "device",
            common: {
                name: "Triggers",
                desc: "Triggers created by Assistant",
            },
            native: {},
        });

        // Create objects for each model
        for (let model of models) {
            const modelName = model.value;
            model = this.stringToAlphaNumeric(model.value);
            this.log.debug(`Initializing objects for model: ${model}`);

            await this.setObjectAsync(`Models.${model}`, {
                type: "device",
                common: {
                    name: model,
                    desc: `Model ${modelName} for the AI Assistant`,
                },
                native: {},
            });

            await this.setObjectAsync(`Models.${model}.statistics`, {
                type: "device",
                common: {
                    name: "Statistics",
                    desc: `Statistics for the model ${modelName} like requests count, tokens used, etc.`,
                },
                native: {},
            });

            await this.setObjectAsync(`Models.${model}.response`, {
                type: "device",
                common: {
                    name: "Response data",
                    desc: `Response data for the model ${modelName} like raw response, error response, etc.`,
                },
                native: {},
            });

            await this.setObjectAsync(`Models.${model}.request`, {
                type: "device",
                common: {
                    name: "Request data",
                    desc: `Request data for the model ${modelName} like request body, state, etc.`,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync(`Models.${model}.request.state`, {
                type: "state",
                common: {
                    name: "Request state",
                    desc: "State for the running inference request",
                    type: "string",
                    role: "indicator",
                    read: true,
                    write: false,
                    def: "",
                },
                native: {},
            });

            await this.setObjectNotExistsAsync(`Models.${model}.request.body`, {
                type: "state",
                common: {
                    name: "Request body",
                    desc: "Sent body for the running inference request",
                    type: "string",
                    role: "indicator",
                    read: true,
                    write: false,
                    def: "",
                },
                native: {},
            });

            await this.setObjectNotExistsAsync(`Models.${model}.response.raw`, {
                type: "state",
                common: {
                    name: "Raw response",
                    desc: `Raw response for model${modelName}`,
                    type: "string",
                    role: "indicator",
                    read: true,
                    write: false,
                    def: "",
                },
                native: {},
            });

            await this.setObjectNotExistsAsync(`Models.${model}.response.error`, {
                type: "state",
                common: {
                    name: "Error response",
                    desc: `Error response for model${modelName}`,
                    type: "string",
                    role: "indicator",
                    read: true,
                    write: false,
                    def: "",
                },
                native: {},
            });

            await this.setObjectNotExistsAsync(`Models.${model}.statistics.tokens_input`, {
                type: "state",
                common: {
                    name: "Input tokens",
                    desc: `Used input tokens for model${modelName}`,
                    type: "number",
                    role: "indicator",
                    read: true,
                    write: false,
                    def: 0,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync(`Models.${model}.statistics.tokens_output`, {
                type: "state",
                common: {
                    name: "Output tokens",
                    desc: `Used output tokens for model${modelName}`,
                    type: "number",
                    role: "indicator",
                    read: true,
                    write: false,
                    def: 0,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync(`Models.${model}.statistics.requests_count`, {
                type: "state",
                common: {
                    name: "Count requests",
                    desc: `Count of requests for model${modelName}`,
                    type: "number",
                    role: "indicator",
                    read: true,
                    write: false,
                    def: 0,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync(`Models.${model}.statistics.last_request`, {
                type: "state",
                common: {
                    name: "Last request",
                    desc: `Last request for model${modelName}`,
                    type: "string",
                    role: "indicator",
                    read: true,
                    write: false,
                    def: "",
                },
                native: {},
            });
        }

        // Create objects for assistant
        this.log.debug("Initializing objects for Assistant: ");

        await this.setObjectAsync("Assistant.text_request", {
            type: "state",
            common: {
                name: "Start request",
                desc: "Text to send to the Assistant",
                type: "string",
                role: "text",
                read: true,
                write: true,
                def: "",
            },
            native: {},
        });

        await this.setObjectNotExistsAsync("Assistant.text_response", {
            type: "state",
            common: {
                name: "Text response",
                desc: "Text response from the Assistant",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: "",
            },
            native: {},
        });

        await this.setObjectAsync("Assistant.statistics", {
            type: "device",
            common: {
                name: "Statistics",
                desc: "Statistics for the Assistant like requests count, tokens used, etc.",
            },
            native: {},
        });

        await this.setObjectAsync("Assistant.response", {
            type: "device",
            common: {
                name: "Response data",
                desc: "Response data for the Assistant like raw response, error response, etc.",
            },
            native: {},
        });

        await this.setObjectAsync("Assistant.request", {
            type: "device",
            common: {
                name: "Request data",
                desc: "Request data for the Assistant like request body, state, etc.",
            },
            native: {},
        });

        await this.setObjectNotExistsAsync("Assistant.statistics.messages", {
            type: "state",
            common: {
                name: "Previous messages",
                desc: "Previous messages for the Assistant",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: '{"messages": []}',
            },
            native: {},
        });

        await this.setObjectAsync("Assistant.statistics.clear_messages", {
            type: "state",
            common: {
                name: "Clear messages",
                desc: "Clear previous message history for the Assistant",
                type: "boolean",
                role: "button",
                read: true,
                write: true,
                def: true,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync("Assistant.request.state", {
            type: "state",
            common: {
                name: "State",
                desc: "State for the running inference request",
                type: "string",
                role: "indicator",
                read: true,
                write: false,
                def: "",
            },
            native: {},
        });

        await this.setObjectNotExistsAsync("Assistant.request.body", {
            type: "state",
            common: {
                name: "Request body",
                desc: "Sent body for the running inference request",
                type: "string",
                role: "indicator",
                read: true,
                write: false,
                def: "",
            },
            native: {},
        });

        await this.setObjectNotExistsAsync("Assistant.response.raw", {
            type: "state",
            common: {
                name: "Response Raw",
                desc: "Raw response from Assistant",
                type: "string",
                role: "indicator",
                read: true,
                write: false,
                def: "",
            },
            native: {},
        });

        await this.setObjectNotExistsAsync("Assistant.response.error", {
            type: "state",
            common: {
                name: "Error response",
                desc: "Error response from Assistant",
                type: "string",
                role: "indicator",
                read: true,
                write: false,
                def: "",
            },
            native: {},
        });

        await this.setObjectNotExistsAsync("Assistant.statistics.tokens_input", {
            type: "state",
            common: {
                name: "Input tokens",
                desc: "Used input tokens for Assistant",
                type: "number",
                role: "indicator",
                read: true,
                write: false,
                def: 0,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync("Assistant.statistics.tokens_output", {
            type: "state",
            common: {
                name: "Output tokens",
                desc: "Used output tokens for Assistant",
                type: "number",
                role: "indicator",
                read: true,
                write: false,
                def: 0,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync("Assistant.statistics.requests_count", {
            type: "state",
            common: {
                name: "Requests count",
                desc: "Count of requests for Assistant",
                type: "number",
                role: "indicator",
                read: true,
                write: false,
                def: 0,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync("Assistant.statistics.last_request", {
            type: "state",
            common: {
                name: "Last request",
                desc: "Last request for Assistant",
                type: "string",
                role: "indicator",
                read: true,
                write: false,
                def: "",
            },
            native: {},
        });

        this.subscribeStates("*");

        this.log.info("Adapter ready");
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - The callback function.
     */
    onUnload(callback) {
        try {
            for (const timeout of this.timeouts) {
                clearTimeout(timeout);
            }
            callback();
        } catch (e) {
            this.log.warn(`Error on unload: ${e}`);
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     *
     * @param id - The state ID that changed.
     * @param state - The new state.
     */
    async onStateChange(id, state) {
        if (state) {
            // The state was changed
            //this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);

            if (id.includes(".clear_messages") && state.val) {
                await this.clearHistory();
            }

            if (id.includes("Assistant.") && id.includes(".text_request") && state.val) {
                this.startAssistantRequest(state.val);
            }

            this.trigger.triggerCheck(id, state.val);
        }
    }

    /**
     * Clear the chat history for the Assistant.
     */
    async clearHistory() {
        this.log.info("Clearing message history");
        await this.setStateAsync("Assistant.statistics.messages", { val: '{"messages": []}', ack: true });
        await this.setStateAsync("Assistant.response.raw", { val: null, ack: true });
        await this.setStateAsync("Assistant.text_response", { val: null, ack: true });
        await this.setStateAsync("Assistant.response.error", { val: null, ack: true });
        await this.setStateAsync("Assistant.request.body", { val: null, ack: true });
        await this.setStateAsync("Assistant.request.state", { val: null, ack: true });
    }

    /**
     * Start a request for the Assistant with the specified text.
     *
     * @param text - The text to send to the Assistant.
     * @param tries - The number of tries for the request.
     * @param try_only_once - If true, the request will only be tried once.
     * @param functionResponse - If true, the request will be started as function response.
     */
    async startAssistantRequest(text, tries = 0, try_only_once = false, functionResponse = false) {
        this.log.info(`Starting request for Assistant with text: ${text}`);
        if (tries == 1) {
            await this.setStateAsync("Assistant.request.state", { val: "start", ack: true });
        }
        await this.setStateAsync("Assistant.response.error", { val: "", ack: true });

        if (this.provider) {
            if (!this.provider.apiTokenCheck()) {
                this.log.warn(`No API token set for provider ${this.provider.name}, cant start request!`);
                return false;
            }

            const messages = [];
            let messagePairs = { messages: [] };

            if (this.config.chat_history > 0) {
                this.log.debug("Chat history is enabled for Assistant");
                messagePairs = await this.getValidatedMessageHistory();
                this.log.debug("Adding previous message pairs for request");
            }

            this.log.debug("Converting message pairs to chat format for request to model");
            for (const message of messagePairs.messages) {
                this.log.debug(`Adding message pair to request array: ${message.user} - ${message.assistant}`);
                messages.push({ role: "user", content: message.user });
                messages.push({ role: "assistant", content: message.assistant });
            }

            let textMessage = text;
            if (!functionResponse) {
                this.log.debug(`Adding user message to request array: ${textMessage}`);
                textMessage = `
					 ${I18n.translate("assistant_current_time")} ${new Date().toLocaleString()}
					 ${I18n.translate("assistant_output_language")} ${this.config.assistant_language}
					 ${I18n.translate("assistant_message_from_user")} ${text}
				`;
            } else {
                this.log.debug(`Adding function response to request array: ${textMessage}`);
            }

            this.log.debug(`Adding user message to request array: ${textMessage}`);
            messages.push({ role: "user", content: textMessage });

            const modelResponse = await this.startModelRequest(
                messages,
                await this.buildSystemPrompt(),
                this.config.max_tokens,
                this.config.temperature,
            );
            let requestCompleted = true;

            if (modelResponse.error) {
                await this.setStateAsync("Assistant.request.state", { val: "error", ack: true });
                await this.setStateAsync("Assistant.request.body", {
                    val: JSON.stringify(modelResponse.requestData),
                    ack: true,
                });
                await this.setStateAsync("Assistant.response.error", { val: modelResponse.error, ack: true });
                await this.setStateAsync("Assistant.response.raw", {
                    val: JSON.stringify(modelResponse.responseData),
                    ack: true,
                });
                this.log.warn(`Request for Assistant failed Text: ${text} Error: ${modelResponse.error}`);
                requestCompleted = false;
            } else {
                await this.setStateAsync("Assistant.request.state", { val: "success", ack: true });
                await this.setStateAsync("Assistant.request.body", {
                    val: JSON.stringify(modelResponse.requestData),
                    ack: true,
                });
                await this.setStateAsync("Assistant.response.error", { val: "", ack: true });
                await this.setStateAsync("Assistant.response.raw", {
                    val: JSON.stringify(modelResponse.responseData),
                    ack: true,
                });
                if (modelResponse.text && modelResponse.text.trim() != "") {
                    modelResponse.text = modelResponse.text.replace(/(\r\n|\n|\r|\t)/gm, "");
                    this.log.debug(`Assistant response: ${modelResponse.text}`);
                    try {
                        this.handleAssistantResponse(modelResponse.text);
                    } catch (error) {
                        this.log.error(`Error handling Assistant response: ${error}`);
                        await this.setStateAsync("Assistant.request.state", { val: "error", ack: true });
                        await this.setStateAsync("Assistant.request.body", {
                            val: JSON.stringify(modelResponse.requestData),
                            ack: true,
                        });
                        await this.setStateAsync("Assistant.response.error", { val: error, ack: true });
                        await this.setStateAsync("Assistant.response.raw", {
                            val: JSON.stringify(modelResponse.responseData),
                            ack: true,
                        });
                    }
                } else {
                    this.log.warn("Assistant response text is empty, cant handle response!");
                    await this.setStateAsync("Assistant.request.state", { val: "error", ack: true });
                    await this.setStateAsync("Assistant.request.body", {
                        val: JSON.stringify(modelResponse.requestData),
                        ack: true,
                    });
                    await this.setStateAsync("Assistant.response.error", {
                        val: "Malformed model answer or missing text response",
                        ack: true,
                    });
                    await this.setStateAsync("Assistant.response.raw", {
                        val: JSON.stringify(modelResponse.responseData),
                        ack: true,
                    });
                    requestCompleted = false;
                }
            }

            if (!requestCompleted) {
                if (!this.config.retry_delay) {
                    this.config.retry_delay = 15;
                }
                if (!this.config.max_retries) {
                    this.config.max_retries = 3;
                }
                await this.setStateAsync("Assistant.request.state", { val: "retry", ack: true });
                if (tries < this.config.max_retries && !try_only_once) {
                    let retry_delay = this.config.retry_delay * 1000;
                    if (tries == this.config.max_retries) {
                        retry_delay = 0;
                    }
                    this.log.debug(
                        `Try ${tries}${1}/${this.config.max_retries} of request for Assistant failed Text: ${text}`,
                    );
                    tries = tries + 1;
                    this.log.debug(`Retry request for Assistant in ${this.config.retry_delay} seconds Text: ${text}`);
                    const timeoutConfig = {
                        text: text,
                        tries: tries,
                        try_only_once: try_only_once,
                        functionResponse: functionResponse,
                    };
                    this.timeouts.push(
                        setTimeout(
                            timeoutConfig => {
                                this.startAssistantRequest(
                                    timeoutConfig.text,
                                    timeoutConfig.tries,
                                    timeoutConfig.try_only_once,
                                    timeoutConfig.functionResponse,
                                );
                            },
                            retry_delay,
                            timeoutConfig,
                        ),
                    );
                } else {
                    this.log.error(`Request for Assistant failed after ${this.config.max_retries} tries Text: ${text}`);
                    await this.setStateAsync("Assistant.request.state", { val: "failed", ack: true });
                    return false;
                }
            } else {
                this.log.info(`Request for Assistant successful Text: ${text} Response: ${modelResponse.text}`);
                await this.addMessagePairToHistory(
                    text,
                    modelResponse.text,
                    modelResponse.tokens_input,
                    modelResponse.tokens_output,
                    modelResponse.model,
                );
                return modelResponse;
            }
        }
    }

    /**
     * Build the system prompt for the assistant.
     *
     * @returns - The system prompt for the assistant.
     */
    async buildSystemPrompt() {
        let systemPrompt = `
		    ${I18n.translate("assistant_system_prompt_1", this.config.assistant_name, this.config.assistant_personality)}

			${I18n.translate("assistant_system_prompt_2")}
			

		`;
        systemPrompt = systemPrompt + (await this.buildFunctionPrompt());
        return systemPrompt.replace(/(\r\n|\n|\r)/gm, "");
    }

    /**
     * Build the function prompt for the assistant.
     *
     * @returns - The function prompt for the assistant.
     */
    async buildFunctionPrompt() {
        const functionPrompt = `
		    ${I18n.translate("assistant_function_prompt_1")}
			[
				{"name": "states", "description": "${I18n.translate("assistant_function_states_tool")}"},
				{"name": "scheduler", "description": "${I18n.translate("assistant_function_scheduler_tool")}"},
				{"name": "trigger", "description": "${I18n.translate("assistant_function_trigger_tool")}"},
				{"name": "deleteHistory", "description": "${I18n.translate("assistant_function_delete_history")}
				${await this.getCustomFunctionsPrompt()}
			];

			${I18n.translate("assistant_function_prompt_2")}
			{
				"reasoning": "${I18n.translate("assistant_function_reasoning")}",
				"functionCall": "${I18n.translate("assistant_function_call")}",
				"functionTextInstructionString": "${I18n.translate("assistant_function_instruction")}",
				"userResponse": "${I18n.translate("assistant_function_user_response")}"
			}

			${I18n.translate("assistant_function_prompt_3")}

			${I18n.translate("assistant_function_prompt_4")}
		`;
        return functionPrompt.replace(/(\r\n|\n|\r)/gm, "");
    }

    /**
     * Build the custom functions prompt for the assistant.
     *
     * @returns - The custom functions prompt for the assistant.
     */
    async getCustomFunctionsPrompt() {
        let customFunctionPrompt = "";
        if (this.config.available_functions && this.config.available_functions.length > 0) {
            for (const customFunction of this.config.available_functions) {
                customFunctionPrompt = `${customFunctionPrompt}{"name":"${customFunction.name}", "description":"${
                    customFunction.description
                }"},\n`;
            }
        }
        return customFunctionPrompt;
    }

    /**
     * Starts a request for the specified model with the specified messages.
     * Validates the request and returns the response data if the request was successful.
     * Updates the statistics for the model with the response data.
     * Logs the request and response data.
     *
     * @param messages - The messages to send to the model.
     * @param system_prompt - The system prompt for the model.
     * @param max_tokens - The maximum number of tokens to generate.
     * @param temperature - The temperature for the model.
     * @returns - Returns the response data if the request was successful, otherwise false.
     */
    async startModelRequest(messages, system_prompt = null, max_tokens = 2000, temperature = 0.6) {
        const modelDatapointName = this.stringToAlphaNumeric(this.config.assistant_model);

        this.log.info(`Starting request for model: ${this.config.assistant_model}`);

        if (this.provider) {
            if (!this.provider.apiTokenCheck()) {
                this.log.warn(`No API token set for provider ${this.provider.name}, cant start request!`);
                return false;
            }

            await this.setStateAsync(`Models.${modelDatapointName}.request.state`, { val: "start", ack: true });
            await this.setStateAsync(`Models.${modelDatapointName}.response.error`, { val: "", ack: true });

            const request = {
                model: this.config.assistant_model,
                messages: messages,
                max_tokens: max_tokens,
                temperature: temperature,
                system_prompt: system_prompt,
                feedback_device: `Model.${modelDatapointName}`,
            };

            if (!this.validateRequest(request)) {
                await this.setStateAsync(`Models.${modelDatapointName}.request.state`, {
                    val: "error",
                    ack: true,
                });
                await this.setStateAsync(`Models.${modelDatapointName}.response.error`, {
                    val: "Request Validation failed",
                    ack: true,
                });
                this.log.warn(`Request for Model ${this.config.assistant_model} failed validation, stopping request`);
                return;
            }

            const modelResponse = await this.provider.request(request);
            modelResponse.requestData = this.provider.requestData;
            modelResponse.responseData = this.provider.responseData;
            if (modelResponse.error) {
                await this.setStateAsync(`Models.${modelDatapointName}.request.state`, {
                    val: "error",
                    ack: true,
                });
                await this.setStateAsync(`Models.${modelDatapointName}.response.error`, {
                    val: modelResponse.error,
                    ack: true,
                });
                await this.setStateAsync(`Models.${modelDatapointName}.request.body`, {
                    val: JSON.stringify(modelResponse.requestData),
                    ack: true,
                });
                await this.setStateAsync(`Models.${modelDatapointName}.response.raw`, {
                    val: JSON.stringify(modelResponse.responseData),
                    ack: true,
                });
                await this.setStateAsync("Assistant.text_response", {
                    val: `Error: ${modelResponse.error}`,
                    ack: true,
                });
            } else {
                await this.setStateAsync(`Models.${modelDatapointName}.request.state`, {
                    val: "success",
                    ack: true,
                });
                await this.setStateAsync(`Models.${modelDatapointName}.response.error`, { val: "", ack: true });
                await this.setStateAsync(`Models.${modelDatapointName}.request.body`, {
                    val: JSON.stringify(modelResponse.requestData),
                    ack: true,
                });
                await this.setStateAsync(`Models.${modelDatapointName}.response.raw`, {
                    val: JSON.stringify(modelResponse.responseData),
                    ack: true,
                });
                this.updateModelStatistics(this.config.assistant_model, modelResponse);
                this.updateAssistantStatistics(modelResponse);
                modelResponse.text = this.extractJsonString(modelResponse.text);
            }
            return modelResponse;
        }
    }

    /**
     * Extracts the JSON string from the specified input.
     * Returns the JSON string or null if no JSON string was found.
     *
     * @param input - The input to extract the JSON string from.
     * @returns - The JSON string or null if no JSON string was found.
     */
    extractJsonString(input) {
        const jsonStart = input.indexOf("{");
        const jsonEnd = input.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1) {
            return input.substring(jsonStart, jsonEnd + 1);
        }
        return null;
    }

    /**
     * Validates the request object and sets default values if necessary.
     * Logs a warning if the request is invalid.
     * Returns the validated request object or false if the request is invalid.
     *
     * @param requestObj - The request object.
     * @param requestObj.model - The model name.
     * @param requestObj.messages - The messages to send to the model.
     * @param requestObj.feedback_device - The feedback device for the model.
     * @param requestObj.max_tokens - The maximum number of tokens to generate.
     * @param requestObj.temperature - The temperature for the model.
     * @param requestObj.system_prompt - The system prompt for the model.
     * @returns - The validated request object or false if the request is invalid.
     */
    validateRequest(requestObj) {
        if (!requestObj.model || requestObj.model == "") {
            this.log.warn(`No model provided in request, validation failed`);
            return false;
        }
        if (!requestObj.messages || requestObj.messages.length == 0) {
            this.log.warn(`No messages provided in request, validation failed`);
            return false;
        }
        if (!requestObj.feedback_device || requestObj.feedback_device == "") {
            this.log.debug(`No path for feedback objects provided in request, using Model default`);
            requestObj.feedback_device = `Models.${this.stringToAlphaNumeric(requestObj.model)}`;
        }
        if (!requestObj.max_tokens || requestObj.max_tokens == "") {
            this.log.debug(`No max_tokens provided in request, using default value: 2000`);
            requestObj.max_tokens = 2000;
        }
        if (!requestObj.temperature || requestObj.temperature == "") {
            this.log.debug(`No temperature provided in request, using default value: 0.6`);
            requestObj.temperature = 0.6;
        }
        if (!requestObj.system_prompt || requestObj.system_prompt.trim() == "") {
            this.log.debug(`No system prompt provided in request`);
            requestObj.system_prompt = null;
        }
        return requestObj;
    }

    /**
     * Retrieves the message history for the specified bot.
     * Validates the message history and returns an array of messages.
     *
     * @returns - An array of validated messages.
     */
    async getValidatedMessageHistory() {
        this.log.debug("Getting previous message pairs for request");
        const validatedObject = { messages: [] };
        const messageObject = await this.getStateAsync("Assistant.statistics.messages");

        if (messageObject && messageObject.val != null && messageObject.val != "") {
            this.log.debug("Trying to decode history json data");
            const messagesData = JSON.parse(jsonrepair(messageObject.val));

            if (messagesData && messagesData.messages && messagesData.messages.length > 0) {
                for (const message of messagesData.messages) {
                    validatedObject.messages.push(message);
                }
            }
            return validatedObject;
        }
        this.log.warn("Message history object for Assistant not found");
        return validatedObject;
    }

    /**
     * Adds a message pair to the message history for the specified bot.
     *
     * @param user - The user message.
     * @param assistant - The assistant response.
     * @param tokens_input - The number of input tokens used in the request.
     * @param tokens_output - The number of output tokens used in the response.
     * @param model - The model name.
     * @returns - Returns true if the message pair was added successfully, otherwise false.
     */
    async addMessagePairToHistory(user, assistant, tokens_input, tokens_output, model) {
        if (this.config.chat_history > 0) {
            const messagesData = await this.getValidatedMessageHistory();
            this.log.debug("Adding message pair to history");
            messagesData.messages.push({
                user: user,
                assistant: assistant,
                timestamp: Date.now(),
                model: model,
                tokens_input: tokens_input,
                tokens_output: tokens_output,
            });

            while (messagesData.messages.length > this.config.chat_history) {
                this.log.debug("Removing message entry because chat history too big");
                messagesData.messages.shift();
            }

            await this.setStateAsync("Assistant.statistics.messages", { val: JSON.stringify(messagesData), ack: true });
            return true;
        }
        this.log.debug("Chat history disabled for Assistant ");
        return false;
    }

    /**
     * Handles the response data from the model request
     * and updates the statistics for the model.
     *
     * @param responseString - The response data from the model request.
     * @returns - Returns true if the statistics were updated successfully, otherwise false.
     */
    async handleAssistantResponse(responseString) {
        this.log.debug(`Handling response string: ${responseString}`);
        try {
            const responseData = JSON.parse(jsonrepair(responseString));

            if (!responseData.userResponse) {
                this.log.warn("No user reply provided in assistant response data");
                return;
            }

            if (this.config.assistant_debug_output) {
                const debugOutput = `
Reasoning: ${responseData.reasoning}

FunctionCall: ${responseData.functionCall}

FunctionInstruction: ${responseData.functionTextInstructionString}

				`;
                await this.setStateAsync("Assistant.text_response", { val: debugOutput, ack: true });
            }

            if (responseData.functionCall) {
                this.log.info(`Function call detected: ${responseData.functionCall}`);
                if (!responseData.functionTextInstructionString) {
                    this.log.warn(
                        `No function instruction provided in assistant response data. Called function: ${
                            responseData.functionCall
                        }`,
                    );
                }
                await this.setStateAsync("Assistant.text_response", { val: responseData.userResponse, ack: true });
                this.log.debug(`Function instruction: ${responseData.functionTextInstructionString}`);
                const functionResponse = await this.tryToExecuteFunctionCall(
                    responseData.functionCall,
                    responseData.functionTextInstructionString,
                );
                if (functionResponse) {
                    if (this.config.assistant_debug_output) {
                        const debugOutput = `
Received Response from FunctionCall 

FunctionResponseFrom: ${functionResponse.tool}

FunctionReasoning: ${functionResponse.reasoning}

NoticeToAssistant: ${functionResponse.noticeToAssistant}

FunctionResultData: ${JSON.stringify(functionResponse.result)}
						`;
                        await this.setStateAsync("Assistant.text_response", { val: debugOutput, ack: true });
                    }
                    delete functionResponse.reasoning;
                    this.startAssistantRequest(JSON.stringify(functionResponse), 0, false, true);
                }
            } else {
                await this.setStateAsync("Assistant.text_response", { val: responseData.userResponse, ack: true });
            }
        } catch (error) {
            this.log.debug(responseString);
            this.log.error(`Error parsing response data: ${error.message}`);
        }
    }

    /**
     * Tries to execute function call for the specified function name.
     * Returns the result of the function call.
     *
     * @param functionCall - The function name to call.
     * @param functionInstruction - The instruction for the function call.
     * @returns - Returns the result of the function call.
     */
    async tryToExecuteFunctionCall(functionCall, functionInstruction) {
        if (functionCall == "states") {
            this.log.info(`States function call detected: ${functionInstruction}`);
            const toolFunction = new StatesTool(this);
            const toolResult = await toolFunction.request(functionInstruction);
            return toolResult;
        }

        if (functionCall == "scheduler") {
            this.log.info(`Scheduler function call detected: ${functionInstruction}`);
            const toolFunction = this.scheduler;
            const toolResult = await toolFunction.request(functionInstruction);
            return toolResult;
        }

        if (functionCall == "trigger") {
            this.log.info(`Trigger function call detected: ${functionInstruction}`);
            const toolFunction = this.trigger;
            const toolResult = await toolFunction.request(functionInstruction);
            return toolResult;
        }

        if (functionCall == "deleteHistory") {
            this.log.info(`Delete history call detected: ${functionInstruction}`);
            await this.setStateAsync("Assistant.text_response", {
                val: I18n.translate("assistant_function_delete_history_success"),
                ack: true,
            });
            setTimeout(async () => {
                await this.clearHistory();
            }, 3000);
            return null;
        }

        for (const customFunction of this.config.available_functions) {
            if (functionCall == customFunction.name) {
                this.log.info(`Custom function call detected: ${customFunction.name}`);
                const result = await this.tryToExecuteCustomFunctionCall(customFunction, functionInstruction);
                const toolResult = {
                    type: "toolReponse",
                    tool: customFunction.name,
                    noticeToAssistant: I18n.translate("assistant_function_executed"),
                    result: result,
                };
                return toolResult;
            }
        }

        const toolResult = {
            tool: functionCall,
            prompt: functionInstruction,
            noticeToAssistant: I18n.translate("assistant_function_not_implemented"),
            result: null,
        };

        return toolResult;
    }

    /**
     * Tries to execute custom function call for the specified custom function.
     * Returns the result of the custom function call.
     *
     * @param customFunction - The custom function to call.
     * @param functionInstruction - The instruction for the custom function call.
     * @returns - Returns the result of the custom function call.
     */
    async tryToExecuteCustomFunctionCall(customFunction, functionInstruction) {
        this.log.info(`Trying to execute custom function: ${customFunction.name}`);
        const oldResultState = await this.getForeignStateAsync(customFunction.objId_result);
        const oldResultTimestamp = oldResultState.ts;
        let tries = 0;
        await this.setForeignStateAsync(customFunction.objId_request, { val: functionInstruction, ack: false });
        this.log.debug(`Waiting for result from function: ${customFunction.name}`);
        return new Promise(resolve => {
            const checkInterval = setInterval(
                async () => {
                    this.log.debug(`Checking for result from function: ${customFunction.name}`);
                    const newResultState = await this.getForeignStateAsync(customFunction.objId_result);
                    const newResultTimestamp = newResultState.ts;
                    tries += 1;

                    if (newResultTimestamp > oldResultTimestamp) {
                        this.log.info(
                            `Result received from function: ${customFunction.name} Result: ${newResultState.val}`,
                        );
                        clearInterval(checkInterval);
                        resolve(newResultState.val);
                    }

                    if (tries >= 60) {
                        this.log.warn(
                            `No result received from function: ${customFunction.name} on datapoint ${
                                customFunction.objId_result
                            } after 60 seconds`,
                        );
                        clearInterval(checkInterval);
                        resolve(I18n.translate("assistant_function_timeout"));
                    }
                },
                1000,
                this,
            );
        });
    }

    /**
     * Updates the statistics for the specified bot with the response data.
     *
     * @param response - The response from the assistant.
     * @param response.tokens_input - The number of input tokens used in the request.
     * @param response.tokens_output - The number of output tokens used in the response.
     */
    async updateAssistantStatistics(response) {
        this.log.debug("Updating statistics for Assistant with response");

        let input_tokens = await this.getStateAsync("Assistant.statistics.tokens_input");
        let output_tokens = await this.getStateAsync("Assistant.statistics.tokens_output");
        let requests_count = await this.getStateAsync("Assistant.statistics.requests_count");

        if (!input_tokens || input_tokens.val == null || input_tokens.val == "") {
            input_tokens = 0 + response.tokens_input;
        } else {
            input_tokens = input_tokens.val + response.tokens_input;
        }

        if (!output_tokens || output_tokens.val == null || output_tokens.val == "") {
            output_tokens = 0 + response.tokens_output;
        } else {
            output_tokens = output_tokens.val + response.tokens_output;
        }

        if (!requests_count || requests_count.val == null || requests_count.val == "") {
            requests_count = 0 + 1;
        } else {
            requests_count = parseInt(requests_count.val) + 1;
        }

        this.setStateAsync("Assistant.statistics.tokens_input", { val: input_tokens, ack: true });
        this.setStateAsync("Assistant.statistics.tokens_output", { val: output_tokens, ack: true });
        this.setStateAsync("Assistant.statistics.requests_count", { val: requests_count, ack: true });
        this.setStateAsync("Assistant.statistics.last_request", { val: new Date().toISOString(), ack: true });
    }

    /**
     * Converts a string to alphanumeric characters only.
     *
     * @param str - The string to convert.
     * @returns - The converted string.
     */
    stringToAlphaNumeric(str) {
        return str.replace(/[^a-zA-Z0-9-_]/g, "");
    }

    /**
     * Updates the statistics for the specified model with the response data.
     *
     * @param model - The model name.
     * @param response - The response from the model.
     * @param response.tokens_input - The number of input tokens used in the request.
     * @param response.tokens_output - The number of output tokens used in the response.
     */
    async updateModelStatistics(model, response) {
        this.log.debug(`Updating model statistics for model ${model} with response`);

        model = this.stringToAlphaNumeric(model);

        let input_tokens = await this.getStateAsync(`Models.${model}.statistics.tokens_input`);
        let output_tokens = await this.getStateAsync(`Models.${model}.statistics.tokens_output`);
        let requests_count = await this.getStateAsync(`Models.${model}.statistics.requests_count`);

        if (!input_tokens || input_tokens.val == null || input_tokens.val == "") {
            input_tokens = 0 + response.tokens_input;
        } else {
            input_tokens = input_tokens.val + response.tokens_input;
        }

        if (!output_tokens || output_tokens.val == null || output_tokens.val == "") {
            output_tokens = 0 + response.tokens_output;
        } else {
            output_tokens = output_tokens.val + response.tokens_output;
        }

        if (!requests_count || requests_count.val == null || requests_count.val == "") {
            requests_count = 0 + 1;
        } else {
            requests_count = parseInt(requests_count.val) + 1;
        }

        this.setStateAsync(`Models.${model}.statistics.tokens_input`, { val: input_tokens, ack: true });
        this.setStateAsync(`Models.${model}.statistics.tokens_output`, { val: output_tokens, ack: true });
        this.setStateAsync(`Models.${model}.statistics.requests_count`, { val: requests_count, ack: true });
        this.setStateAsync(`Models.${model}.statistics.last_request`, {
            val: new Date().toISOString(),
            ack: true,
        });
    }

    /**
     * Retrieves the available models from the configuration.
     *
     * @returns An array of available models with their labels and values.
     */
    getAvailableModels() {
        const models = [];
        for (const model of this.config.anth_models) {
            models.push({ label: model.model_name, value: model.model_name });
        }
        for (const model of this.config.opai_models) {
            models.push({ label: model.model_name, value: model.model_name });
        }
        for (const model of this.config.custom_models) {
            models.push({ label: model.model_name, value: model.model_name });
        }
        for (const model of this.config.pplx_models) {
            models.push({ label: model.model_name, value: model.model_name });
        }
        for (const model of this.config.oprt_models) {
            models.push({ label: model.model_name, value: model.model_name });
        }
        return models;
    }

    /**
     * Gets the model provider for the specified model name.
     *
     * @param requestedModel - The model name to find the provider for.
     * @returns - The model provider instance or null if not found.
     */
    getModelProvider(requestedModel) {
        this.log.debug(`Getting provider for Model ${requestedModel}`);

        const anth_models = this.config.anth_models;
        const opai_models = this.config.opai_models;
        const pplx_models = this.config.pplx_models;
        const oprt_models = this.config.oprt_models;
        const custom_models = this.config.custom_models;

        if (anth_models.length > 0) {
            for (const model of anth_models) {
                if (model.model_name == requestedModel && model.model_active) {
                    this.log.debug(`Provider for Model ${model.model_name} is Anthropic`);
                    return new AnthropicAiProvider(this);
                }
            }
        }

        if (opai_models.length > 0) {
            for (const model of opai_models) {
                if (model.model_name == requestedModel && model.model_active) {
                    this.log.debug(`Provider for Model ${model.model_name} is OpenAI`);
                    return new OpenAiProvider(this);
                }
            }
        }

        if (custom_models.length > 0) {
            for (const model of custom_models) {
                if (model.model_name == requestedModel && model.model_active) {
                    this.log.debug(`Provider for Model ${model.model_name} is Custom/Selfhosted`);
                    return new CustomAiProvider(this);
                }
            }
        }

        if (pplx_models.length > 0) {
            for (const model of pplx_models) {
                if (model.model_name == requestedModel && model.model_active) {
                    this.log.debug(`Provider for Model ${model.model_name} is Perplexity`);
                    return new PerplexityAiProvider(this);
                }
            }
        }

        if (oprt_models.length > 0) {
            for (const model of oprt_models) {
                if (model.model_name == requestedModel && model.model_active) {
                    this.log.debug(`Provider for Model ${model.model_name} is OpenRouter`);
                    return new OpenRouterAiProvider(this);
                }
            }
        }

        this.log.warn(`No provider found for model ${requestedModel}`);
        return null;
    }

    /**
     * Retrieves the datapoints from enums and adds them to the available endpoints.
     *
     * @param enumType - The enum type to retrieve the endpoints from.
     * @returns - The available endpoints structure.
     */
    async getEndpointsFromEnums(enumType = "enum.rooms") {
        this.log.debug(`Getting available endpoints structure from enumType: ${enumType}`);
        const sorting = await this.getEnumsAsync();
        const enumObject = [];
        if (!sorting) {
            this.log.warn(`No enum data found for type: ${enumType}`);
            return enumObject;
        }
        for (const [roomKey] of Object.entries(sorting[enumType])) {
            const room = sorting[enumType][roomKey];
            const sortObject = { name: room.common.name, endpoints: [] };
            if (!room.common.members) {
                continue;
            }
            for (const member of room.common.members) {
                const enumMember = await this.getForeignObjectAsync(member);
                if (enumMember) {
                    if (enumMember.type != "state") {
                        continue;
                    }

                    const tempObject = {
                        name: enumMember.common.name,
                        id: member,
                    };

                    this.log.debug(`Adding available endpoint: ${JSON.stringify(tempObject)}`);
                    sortObject.endpoints.push(tempObject);
                }
            }
            enumObject.push(sortObject);
        }
        return enumObject;
    }

    /**
     * Creates a structure with the available endpoints for the assistant.
     *
     * @returns - The available endpoints structure.
     */
    async getAvailableEndpointsStructure() {
        const endpointsConfig = this.config.available_endpoints;
        if (!endpointsConfig || endpointsConfig.length == 0) {
            this.log.warn("No available endpoints found in config");
            return null;
        }
        const sortingCategories = {};
        for (const endpoint of endpointsConfig) {
            sortingCategories[endpoint.sort] = [];
        }
        for (const endpoint of endpointsConfig) {
            const stateObject = await this.getForeignObjectAsync(endpoint.objId);

            if (stateObject) {
                if (stateObject.type != "state") {
                    continue;
                }

                const tempObject = {
                    name: endpoint.name,
                    id: endpoint.objId,
                    type: stateObject.common.type,
                };

                tempObject.write = stateObject.common.write;
                tempObject.read = stateObject.common.read;

                if (stateObject.common.type == "number") {
                    if (stateObject.common.unit != undefined && stateObject.common.unit.trim() != "") {
                        tempObject.unit = stateObject.common.unit;
                    }
                    if (stateObject.common.max != undefined && stateObject.common.max != null) {
                        tempObject.max = stateObject.common.max;
                    }
                    if (stateObject.common.min != undefined && stateObject.common.min != null) {
                        tempObject.min = stateObject.common.min;
                    }
                    if (stateObject.common.step != undefined && stateObject.common.step != null) {
                        tempObject.step = stateObject.common.step;
                    }
                }

                if (stateObject.common.states != undefined) {
                    tempObject.allowed_states = stateObject.common.states;
                }

                this.log.debug(`Adding available endpoint: ${JSON.stringify(tempObject)}`);
                sortingCategories[endpoint.sort].push(tempObject);
            }
        }
        return JSON.stringify(sortingCategories);
    }

    /**
     * Handles incoming messages from the assistant.
     *
     * @param obj - The incoming message object.
     * @returns - The response to the incoming message.
     */
    async onMessage(obj) {
        this.log.debug(`Message received: ${JSON.stringify(obj)}`);
        if (typeof obj === "object" && obj.message) {
            if (obj.command === "importFromEnums") {
                this.log.debug("importFromEnums command");
                const enumImport = await this.getEndpointsFromEnums();
                const objects = [];
                for (const sortEnum of enumImport) {
                    for (const endpoint of sortEnum.endpoints) {
                        objects.push({ active: true, sort: sortEnum.name, name: endpoint.name, objId: endpoint.id });
                    }
                }

                this.log.debug(`Imported enum data: ${JSON.stringify({ native: { available_endpoints: objects } })}`);
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, { native: { available_endpoints: objects } }, obj.callback);
                }
            }

            if (obj.command === "getAvailableModels") {
                this.log.debug("getAvailableModels command");
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, this.getAvailableModels(), obj.callback);
                }
            }
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param options - The options for the assistant.
     */
    module.exports = options => new AiAssistant(options);
} else {
    // otherwise start the instance directly
    new AiAssistant();
}
