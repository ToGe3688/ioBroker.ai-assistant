"use strict";

/**
 * CustomAiProvider class
 */
class CustomAiProvider {
    /**
     * @param adapter - The adapter instance
     */
    constructor(adapter) {
        this.name = "CustomAiProvider";
        this.apiUrl = adapter.config.custom_api_url;
        this.apiToken = adapter.config.custom_api_token;
        this.adapter = adapter;
        this.adapter.log.debug(`Created new Custom AI provider`);
        this.requestData = {};
        this.responseData = {};
        this.error = null;
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
        return true;
    }

    /**
     * Sends the actual HTTP request to the OpenRouter AI API
     *
     * @param model - The model to use
     * @param messages - The messages to send to the AI
     * @param max_tokens - The maximum number of tokens to generate
     * @param system_prompt - The system prompt
     * @param temperature - The temperature
     * @returns - The response from the AI
     * @throws {Error} - If the request fails
     */
    async sendRequest(model, messages, max_tokens = 2000, system_prompt = null, temperature = 0.6) {
        const url = this.adapter.config.custom_api_url;

        if (!url || url.trim() == "") {
            this.adapter.log.debug("No api url defined for request");
            throw new Error(`No api url defined for request`);
        }
        this.adapter.log.debug(`API url: ${url}`);

        if (system_prompt) {
            messages.unshift({ role: "system", content: system_prompt });
        }

        this.adapter.log.debug(`Messages array: ${JSON.stringify(messages)}`);

        const body = {
            model: model,
            max_tokens: max_tokens,
            temperature: temperature,
            messages: messages,
        };

        this.adapter.log.debug(`Request body: ${JSON.stringify(body)}`);
        this.requestData = body;

        const response = await fetch(this.apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiToken}`,
            },
            body: JSON.stringify(body),
            agent: new (require("https").Agent)({ rejectUnauthorized: false }),
            timeout: 300000,
        });

        this.adapter.log.debug(`Code: ${response.status}`);

        if (response.status != 200) {
            if (response.status == 400) {
                this.adapter.log.warn(`API invalid request error`);
                throw new Error(`API invalid request error`);
            }
            if (response.status == 401) {
                this.adapter.log.warn(`API token invalid`);
                throw new Error(`API token invalid`);
            }
            if (response.status == 403) {
                this.adapter.log.warn(`API token forbidden`);
                throw new Error(`API token forbidden`);
            }
            if (response.status == 404) {
                this.adapter.log.warn(`API endpoint not found`);
                throw new Error(`API endpoint not found`);
            }
            if (response.status == 413) {
                this.adapter.log.warn(`API request too large error`);
                throw new Error(`API request too large error`);
            }
            if (response.status == 429) {
                this.adapter.log.warn(`API rate limit exceeded`);
                throw new Error(`API rate limit exceeded`);
            }
            if (response.status == 500) {
                this.adapter.log.warn(`API server error`);
                throw new Error(`API server error`);
            }
            if (response.status == 529) {
                this.adapter.log.warn(`API overload error`);
                throw new Error(`API overload error`);
            }
            this.adapter.log.warn(`Unknown error http code${response.status}`);
            throw new Error(`Unknown error http code${response.status}`);
        }

        const data = await response.json();

        this.adapter.log.debug(`Data: ${JSON.stringify(data)}`);

        this.responseData = data;

        if (!data) {
            this.adapter.log.warn(`No data from API error`);
            throw new Error(`No data error`);
        }

        if (data.error) {
            this.adapter.log.warn(`Error from API, see raw response for details: ${data.error.message}`);
            throw new Error(`Error from API, see raw response for details: ${data.error.message}`);
        }

        if (!data.choices || data.choices.length == 0) {
            this.adapter.log.warn(`No answer in data from API error`);
            throw new Error(`No answer in data from API error`);
        }

        if (data.choices[0].message.content == "") {
            this.adapter.log.warn(`Empty assistant answer in data from API`);
            throw new Error(`Empty assistant answer in data from API`);
        }

        if (!data.usage) {
            this.adapter.log.warn(`No usage data in response from API, using defaults`);
            data.usage = {
                input_tokens: 0,
                output_tokens: 0,
            };
        }

        const responseObj = {
            text: data.choices[0].message.content,
            model: model,
            tokens_input: data.usage.prompt_tokens,
            tokens_output: data.usage.completion_tokens,
            error: null,
        };

        return responseObj;
    }
}

module.exports = CustomAiProvider;
