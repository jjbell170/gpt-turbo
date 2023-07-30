import { ConversationConfig } from "./ConversationConfig.js";
import { Message } from "./Message.js";
import { v4 as uuid } from "uuid";
import {
    ConversationModel,
    conversationSchema,
} from "../schemas/conversation.schema.js";
import { ConversationRequestOptions } from "./ConversationRequestOptions.js";
import { ConversationHistory } from "./ConversationHistory.js";
import { ConversationCallableFunctions } from "./ConversationCallableFunctions.js";
import { ConversationRequestOptionsModel } from "schemas/conversationRequestOptions.schema.js";
import { ChatCompletionService } from "./ChatCompletionService.js";
import {
    ConversationGlobalPlugins,
    ConversationOptions,
    PluginsFromConversationOptionsWithGlobalPlugins,
    PromptOptions,
} from "../utils/types/index.js";
import { ConversationPluginService } from "./ConversationPluginService.js";
import { ConversationPlugins } from "./ConversationPlugins.js";

/**
 * A Conversation manages the messages sent to and from the OpenAI API and handles the logic for providing the message history to the API for each prompt.
 */
export class Conversation<
    TOptions extends ConversationOptions = ConversationOptions,
> {
    /**
     * Plugins that will be used for all conversations.
     *
     * @remarks
     * Only applies to conversations created after this property is set. Previous conversations will not be affected.
     *
     * @example
     * For TypeScript users, you can achieve type-safe global plugins by overriding the `ConversationGlobalPluginsOverride` interface.
     * ```ts
     * const globalPlugins = [somePlugin, someOtherPlugin];
     *
     * declare module "gpt-turbo" {
     *     interface ConversationGlobalPluginsOverride {
     *         globalPlugins: typeof globalPlugins;
     *     }
     * }
     *
     * Conversation.globalPlugins = globalPlugins;
     * ```
     */
    public static globalPlugins: ConversationGlobalPlugins = [];

    /**
     * A UUID generated by the library for this conversation. Not the same as the conversation ID returned by the OpenAI API.
     */
    public id: string;

    public readonly config: ConversationConfig;
    public readonly requestOptions: ConversationRequestOptions;
    public readonly history: ConversationHistory;
    public readonly callableFunctions: ConversationCallableFunctions;
    public readonly plugins: ConversationPlugins<
        PluginsFromConversationOptionsWithGlobalPlugins<TOptions>
    >;

    private readonly chatCompletionService: ChatCompletionService;
    private readonly pluginService: ConversationPluginService<
        PluginsFromConversationOptionsWithGlobalPlugins<TOptions>
    >;

    /**
     * Creates a new Conversation instance.
     *
     * @param options The options for the Conversation instance's configuration, request options, history, and callable functions.
     */
    constructor(options?: TOptions) {
        const {
            id = uuid(),
            config,
            requestOptions,
            history,
            callableFunctions,
            plugins = [],
            pluginsData,
        } = options ?? {};

        this.id = id;

        this.pluginService = new ConversationPluginService([
            ...Conversation.globalPlugins,
            ...plugins,
        ]);

        this.config = new ConversationConfig(this.pluginService, config);
        this.requestOptions = new ConversationRequestOptions(
            this.pluginService,
            requestOptions
        );
        this.history = new ConversationHistory(
            this.pluginService,
            this.config,
            history
        );
        this.callableFunctions = new ConversationCallableFunctions(
            this.pluginService,
            callableFunctions
        );
        this.plugins = new ConversationPlugins(this.pluginService);

        this.chatCompletionService = new ChatCompletionService(
            this.pluginService,
            this.config,
            this.requestOptions,
            this.history,
            this.callableFunctions
        );

        this.pluginService.onInit(
            {
                conversation: this,
                config: this.config,
                requestOptions: this.requestOptions,
                history: this.history,
                callableFunctions: this.callableFunctions,
                plugins: this.plugins,
                chatCompletionService: this.chatCompletionService,
                pluginService: this.pluginService,
            },
            pluginsData
        );
    }

    /**
     * Creates a new Conversation instance from a JSON object.
     *
     * @param json The JSON object of the Conversation instance.
     * @param plugins The plugins to use for the Conversation instance.
     * @returns The new Conversation instance.
     */
    public static fromJSON(
        json: ConversationModel,
        plugins?: ConversationOptions["plugins"]
    ) {
        const conversationJson = conversationSchema.parse(json);
        const conversationOptions: ConversationOptions = {
            ...conversationJson,
            plugins,
        };
        return new Conversation(conversationOptions);
    }

    /**
     * Serializes the `Conversation` to JSON.
     *
     * @returns A JSON representation of the `Conversation` instance.
     */
    public toJSON(): ConversationModel {
        const json: ConversationModel = {
            id: this.id,
            config: this.config.toJSON(),
            requestOptions: this.requestOptions.toJSON(),
            callableFunctions: this.callableFunctions.toJSON(),
            history: this.history.toJSON(),
            pluginsData: this.pluginService.getPluginsData(),
        };

        return conversationSchema.parse(
            this.pluginService.transformConversationJson(json)
        );
    }

    /**
     * This is the **recommended** way to interact with the GPT model. It's a wrapper method around other public methods that handles the logic of adding a user message, sending a request to the OpenAI API, and adding the assistant's response.
     *
     * @param prompt The prompt to send to the assistant.
     * @param options Additional options to pass to the Create Chat Completion API endpoint. This overrides the config passed to the constructor.
     * @param requestOptions Additional options to pass for the HTTP request. This overrides the config passed to the constructor.
     * @returns The assistant's response as a [`Message`](./Message.js) instance.
     */
    public async prompt(
        prompt: string,
        options?: PromptOptions,
        requestOptions?: ConversationRequestOptionsModel
    ) {
        const userMessage = this.history.addUserMessage(prompt);

        try {
            await this.pluginService.onUserPrompt(userMessage);
            await this.chatCompletionService.moderateMessage(userMessage);
            const assistantMessage =
                await this.chatCompletionService.getAssistantResponse(
                    options,
                    requestOptions
                );
            return assistantMessage;
        } catch (e) {
            await this.pluginService.onUserPromptError(e);
            this.history.removeMessage(userMessage);
            throw e;
        }
    }

    /**
     * Removes all messages starting from (but excluding) the `fromMessage` if it's a user message, or its previous user message if `fromMessage` is an assistant message.
     * Then, the `prompt` method is called using either the specified `newPrompt` or the previous user message's content.
     *
     * This is useful if you want to edit a previous user message (by specifying `newPrompt`) or if you want to regenerate the response to a previous user message (by not specifying `newPrompt`).
     *
     * @param fromMessageOrId The message to re-prompt from. This can be either a message ID or a [`Message`](./Message.js) instance.
     * @param newPrompt The new prompt to use for the previous user message. If not provided, the previous user's message content will be reused.
     * @param options Additional options to pass to the Create Chat Completion API endpoint. This overrides the config passed to the constructor.
     * @param requestOptions Additional options to pass for the HTTP request. This overrides the config passed to the constructor.
     * @returns The assistant's response as a [`Message`](./Message.js) instance.
     *
     * @example
     * ```typescript
     * let assistantRes1 = await conversation.prompt("Hello!"); // Hi
     * let assistantRes2 = await conversation.prompt("How are you?"); // I'm good, how are you?
     *
     * // Regenerate the assistantRes2 response
     * assistantRes2 = await conversation.reprompt(assistantRes2); // Good! What about you?
     *
     * // Edit the initial prompt (and remove all messages after it. In this case, assistantRes2's response)
     * assistantRes1 = await conversation.reprompt(assistantRes1, "Goodbye!"); // See you later!
     * ```
     */
    public async reprompt(
        fromMessageOrId: string | Message,
        newPrompt?: string,
        options?: PromptOptions,
        requestOptions?: ConversationRequestOptionsModel
    ) {
        // Find the message to reprompt from
        const id =
            typeof fromMessageOrId === "string"
                ? fromMessageOrId
                : fromMessageOrId.id;
        const messages = this.history.getMessages();
        const fromIndex = messages.findIndex((m) => m.id === id);
        if (fromIndex === -1) {
            throw new Error(`Message with ID "${id}" not found.`);
        }

        // Find the previous user message
        let previousUserMessageIndex = fromIndex;
        let previousUserMessage = messages[previousUserMessageIndex];
        while (previousUserMessage.role !== "user") {
            previousUserMessageIndex--;
            if (previousUserMessageIndex < 0) break;
            previousUserMessage = messages[previousUserMessageIndex];
        }
        if (previousUserMessage?.role !== "user") {
            throw new Error(
                `Could not find a previous user message to reprompt from (${id}).`
            );
        }

        // Remove all messages from the previous user message (including it)
        messages
            .slice(previousUserMessageIndex)
            .forEach((m) => this.history.removeMessage(m));

        // Edit the previous user message if needed
        if (newPrompt) {
            previousUserMessage.content = newPrompt;
        }

        const prompt = newPrompt ?? previousUserMessage.content ?? "";
        return this.prompt(prompt, options, requestOptions);
    }

    /**
     * Sends the result of a user-evaluated function call to the GPT model and gets the assistant's response.
     * This method should usually be called after receiving a function_call message from the assistant (using `getChatCompletionResponse()` or `prompt()`) and evaluating your own function with the provided arguments from that message.
     *
     * @param name The name of the function used to generate the result. This function must be defined in the `functions` config option.
     * @param result The result of the function call. If the result is anything other than a string, it will be JSON stringified. Since `result` can be anything, the `T` generic is provided for your typing convenience, but is not used internally
     * @param options Additional options to pass to the Create Chat Completion API endpoint. This overrides the config passed to the constructor.
     * @param requestOptions Additional options to pass for the HTTP request. This overrides the config passed to the constructor.
     * @returns The assistant's response as a [`Message`](./Message.js) instance.
     */
    public async functionPrompt<T = any>(
        name: string,
        result: T,
        options?: PromptOptions,
        requestOptions?: ConversationRequestOptionsModel
    ) {
        const transformedResult =
            await this.pluginService.transformFunctionResult(result);
        const functionMessage = this.history.addFunctionMessage(
            typeof transformedResult === "string"
                ? transformedResult
                : JSON.stringify(transformedResult),
            name
        );

        try {
            await this.pluginService.onFunctionPrompt(functionMessage);
            await this.chatCompletionService.moderateMessage(functionMessage);
            const assistantMessage =
                await this.chatCompletionService.getAssistantResponse(
                    options,
                    requestOptions
                );
            return assistantMessage;
        } catch (e) {
            await this.pluginService.onFunctionPromptError(e);
            this.history.removeMessage(functionMessage);
            throw e;
        }
    }

    /**
     * Sends a Create Chat Completion request to the OpenAI API using the current messages stored in the conversation's history.
     *
     * @remarks
     * This method is solely provided for client code that wants to trigger a Create Chat Completion request manually.
     * It is not used internally by the library and does not moderate messages before sending them to the API.
     *
     * @param options Additional options to pass to the Create Chat Completion API endpoint. This overrides the config passed to the constructor.
     * @param requestOptions Additional options to pass for the HTTP request. This overrides the config passed to the constructor.
     * @returns A new [`Message`](./Message.js) instance with the role of "assistant" and the content set to the response from the OpenAI API. If the `stream` config option was set to `true`, the content will be progressively updated as the response is streamed from the API. Listen to the returned message's `onUpdate` event to get the updated content.
     */
    public async getChatCompletionResponse(
        ...args: Parameters<ChatCompletionService["getChatCompletionResponse"]>
    ) {
        return this.chatCompletionService.getChatCompletionResponse(...args);
    }
}
