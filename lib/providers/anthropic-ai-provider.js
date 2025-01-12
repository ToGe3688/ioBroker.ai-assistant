"use strict";
/**
 * AnthropicAiProvider class
 */
class AnthropicAiProvider {
    /**
     * @param adapter - The adapter instance
     */
    constructor(adapter) {
        this.name = "Anthropic AI";
        this.apiToken = adapter.config.anth_api_token;
        this.adapter = adapter;
        this.requestData = {};
        this.responseData = {};
        this.error = null;
        this.defaultTimeout = 30000;
        this.adapter.log.debug(`Created new ${this.name}`);
    }

    /**
     * Sends a request to the OpenRouter AI API
     *
     * @param requestObject - The request object
     * @returns - The response from the AI
     * @throws {Error} - If the request fails
     */
    async request(requestObject) {
        let response = {};
        try {
            response = await this.sendRequest(
                requestObject.model,
                requestObject.messages,
                requestObject.max_tokens,
                requestObject.system_prompt,
                requestObject.temperature,
            );
        } catch (error) {
            response.error = error.message;
        }
        return response;
    }

    /**
     * Checks if the API token is set
     *
     * @returns - True if the API token is set
     */
    apiTokenCheck() {
        if (!this.apiToken) {
            return false;
        }
        return true;
    }

    /**
     * Sends the actual HTTP request to the Anthropic AI API
     *
     * @param model - The model to use for the request
     * @param messages - The messages to send to the AI
     * @param max_tokens - The maximum number of tokens to generate
     * @param system_prompt - The system prompt to use
     * @param temperature - The temperature to use
     * @returns - The response from the AI
     */
    async sendRequest(model, messages, max_tokens = 2000, system_prompt = null, temperature = 0.6) {
        const url = "https://api.anthropic.com/v1/messages";

        // Convert image objects to content objects for the API
        const convertedMessages = [];
        for (const message of messages) {
            if (typeof message.image !== "undefined") {
                this.adapter.log.debug(`${this.name}: Image detected in message, adding to content`);
                if (typeof message.image.mimeType !== "undefined" && typeof message.image.base64 !== "undefined") {
                    message.content = [
                        {
                            type: "image",
                            source: { type: "base64", media_type: message.image.mimeType, data: message.image.base64 },
                        },
                        { type: "text", text: message.content },
                    ];
                    delete message.image;
                } else {
                    this.adapter.log.warn(
                        `${this.name}: Image object is missing base64 or mimeType property, skipping image`,
                    );
                }
            }
            convertedMessages.push(message);
        }
        messages = convertedMessages;

        this.adapter.log.debug(`${this.name}: Messages array: ${JSON.stringify(messages)}`);

        // Create the request body
        const body = {
            model: model,
            system: system_prompt,
            messages: messages,
            max_tokens: max_tokens,
            temperature: temperature,
        };

        this.adapter.log.debug(`${this.name}: Request body: ${JSON.stringify(body)}`);
        this.requestData = body;

        let response = {};

        if (!this.adapter.config.anth_api_version) {
            this.adapter.log.warn(`${this.name}: API version not set, using default: 2023-06-01`);
            this.adapter.config.anth_api_version = "2023-06-01";
        }

        // Send the request
        try {
            response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "anthropic-version": this.adapter.config.anth_api_version,
                    "x-api-key": this.apiToken,
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(this.defaultTimeout),
            });
        } catch (e) {
            if (e.name === "TimeoutError") {
                this.adapter.log.warn(`${this.name}: Request timed out`);
                throw new Error(`Request timed out`);
            } else {
                this.adapter.log.warn(`${this.name}: Request failed: ${e.message}`);
                throw new Error(`Request failed: ${e.message}`);
            }
        }

        this.adapter.log.debug(`${this.name}: Response-Code: ${response.status}`);

        // Check the response status
        if (response.status != 200) {
            if (response.status == 400) {
                this.adapter.log.warn(`${this.name}: API invalid request error`);
                const data = await response.json();
                this.adapter.log.warn(`${this.name}: ${data.error.message}`);
                throw new Error(data.error.message);
            }
            if (response.status == 401) {
                this.adapter.log.warn(`${this.name}: API token invalid`);
                throw new Error(`API token invalid`);
            }
            if (response.status == 403) {
                this.adapter.log.warn(`${this.name}: API token forbidden`);
                throw new Error(`API token forbidden`);
            }
            if (response.status == 404) {
                this.adapter.log.warn(`${this.name}: API endpoint not found`);
                throw new Error(`API endpoint not found`);
            }
            if (response.status == 413) {
                this.adapter.log.warn(`${this.name}: API request too large error`);
                throw new Error(`API request too large error`);
            }
            if (response.status == 429) {
                this.adapter.log.warn(`${this.name}: API rate limit exceeded`);
                throw new Error(`API rate limit exceeded`);
            }
            if (response.status == 500) {
                this.adapter.log.warn(`${this.name}: API server error`);
                throw new Error(`API server error`);
            }
            if (response.status == 529) {
                this.adapter.log.warn(`${this.name}: API overload error`);
                throw new Error(`API overload error`);
            }
            this.adapter.log.warn(`${this.name}: Unknown error http code: ${response.status}`);
            throw new Error(`Unknown error http code: ${response.status}`);
        }

        const data = await response.json();

        this.adapter.log.debug(`${this.name}: Data: ${JSON.stringify(data)}`);
        this.responseData = data;

        if (!data) {
            this.adapter.log.warn(`${this.name}: No data from API error`);
            throw new Error(`No data error`);
        }

        if (data.error) {
            this.adapter.log.warn(`${this.name}: Error from API, see raw response for details: ${data.error.message}`);
            throw new Error(`Error from API, see raw response for details: ${data.error.message}`);
        }

        if (!data.content || data.content.length == 0) {
            this.adapter.log.warn(`${this.name}: No answer in data from API error`);
            throw new Error(`No answer in data from API error`);
        }

        if (data.role != "assistant") {
            this.adapter.log.warn(`${this.name}: No assistant answer in data from API error`);
            throw new Error(`No assistant answer in data from API error`);
        }

        if (data.content[0].text == "") {
            this.adapter.log.warn(`${this.name}: Empty assistant answer in data from API`);
            throw new Error(`Empty assistant answer in data from API`);
        }

        if (!data.usage) {
            this.adapter.log.warn(`${this.name}: No usage data in response from API, using defaults`);
            data.usage = {
                input_tokens: 0,
                output_tokens: 0,
            };
        }

        const responseObj = {
            text: data.content[0].text,
            model: model,
            tokens_input: data.usage.input_tokens,
            tokens_output: data.usage.output_tokens,
            error: null,
        };

        return responseObj;
    }
}

module.exports = AnthropicAiProvider;
