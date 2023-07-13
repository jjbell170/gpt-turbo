import React from "react";
import {
    CallableFunctionsContext,
    CallableFunctionsContextValue,
} from "../CallableFunctionsContext";
import { notifications } from "@mantine/notifications";
import { randomId } from "@mantine/hooks";
import { BiCheck, BiX } from "react-icons/bi";
import getErrorInfo from "../../utils/getErrorInfo";
import { useAppStore } from "../../store";

interface CallableFunctionsProviderProps {
    children?: React.ReactNode;
}

const CallableFunctionsProvider = ({
    children,
}: CallableFunctionsProviderProps) => {
    const [functions, displayNames, codes] = useAppStore((state) => [
        state.callableFunctions,
        state.callableFunctionDisplayNames,
        state.callableFunctionCodes,
    ]);

    const getCallableFunction = React.useCallback<
        CallableFunctionsContextValue["getCallableFunction"]
    >(
        (id) => {
            const callableFunction = functions.find((fn) => fn.id === id);
            if (callableFunction === undefined) {
                throw new Error(`No callable function found with id "${id}"`);
            }
            return callableFunction;
        },
        [functions]
    );

    const getCallableFunctionDisplayName = React.useCallback<
        CallableFunctionsContextValue["getCallableFunctionDisplayName"]
    >(
        (id) => {
            const displayName = displayNames[id];
            if (displayName === undefined) {
                throw new Error(
                    `No display name found for callable function with id "${id}"`
                );
            }
            return displayName;
        },
        [displayNames]
    );

    const getCallableFunctionCode = React.useCallback<
        CallableFunctionsContextValue["getCallableFunctionCode"]
    >(
        (id) => {
            return codes[id];
        },
        [codes]
    );

    const callFunction = React.useCallback<
        CallableFunctionsContextValue["callFunction"]
    >(
        async (id, args) => {
            const callableFunction = getCallableFunction(id);
            const displayName = getCallableFunctionDisplayName(id);

            const code = getCallableFunctionCode(id);
            if (!code) return undefined;

            try {
                const { argNames, argValues } =
                    callableFunction.parameters.reduce(
                        (acc, fn) => {
                            acc.argNames.push(fn.name);
                            acc.argValues.push(args[fn.name] ?? undefined);
                            return acc;
                        },
                        {
                            argNames: [],
                            argValues: [],
                        } as { argNames: string[]; argValues: any[] }
                    );
                const fn = new Function(...argNames, code);

                const result = fn(...argValues);

                if (result instanceof Promise) {
                    const notifId = randomId();
                    notifications.show({
                        id: notifId,
                        loading: true,
                        title: "Function Call",
                        message: `Calling ${displayName}...`,
                        autoClose: false,
                        withCloseButton: false,
                    });

                    try {
                        const awaited = await result;

                        notifications.update({
                            id: notifId,
                            color: "green",
                            title: "Function Call Success",
                            message: `${displayName} called successfully!`,
                            icon: <BiCheck />,
                            autoClose: 2000,
                        });

                        return awaited;
                    } catch (e) {
                        notifications.hide(notifId);
                        throw e;
                    }
                }

                return result;
            } catch (e) {
                console.error(e);
                const { message } = getErrorInfo(e);
                notifications.show({
                    color: "red",
                    title: "Function Call Failed",
                    message: `${displayName} failed: ${message}`,
                    icon: <BiX />,
                    autoClose: false,
                    withCloseButton: true,
                });
                return undefined;
            }
        },
        [
            getCallableFunction,
            getCallableFunctionCode,
            getCallableFunctionDisplayName,
        ]
    );

    const providerValue = React.useMemo<CallableFunctionsContextValue>(
        () => ({
            getCallableFunction,
            getCallableFunctionDisplayName,
            getCallableFunctionCode,
            callFunction,
        }),
        [
            callFunction,
            getCallableFunction,
            getCallableFunctionCode,
            getCallableFunctionDisplayName,
        ]
    );

    return (
        <CallableFunctionsContext.Provider value={providerValue}>
            {children}
        </CallableFunctionsContext.Provider>
    );
};

export default CallableFunctionsProvider;
