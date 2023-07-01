import { zodResolver } from "@mantine/form";
import { v4 as uuid } from "uuid";
import {
    CallableFunctionFormContext,
    CallableFunctionFormValues,
} from "../CallableFunctionFormContext";
import { persistenceCallableFunctionSchema } from "../../entities/persistenceCallableFunction";
import React from "react";
import useCallableFunctions from "../../hooks/useCallableFunctions";

export interface CallableFunctionFormProviderProps {
    children: React.ReactNode;
    onSubmit: (values: CallableFunctionFormValues) => void | Promise<void>;
    id?: string;
}

const CallableFunctionFormProvider = ({
    children,
    onSubmit,
    id,
}: CallableFunctionFormProviderProps) => {
    const {
        callableFunctions,
        getCallableFunctionDisplayName,
        getCallableFunctionCode,
    } = useCallableFunctions();
    const form = CallableFunctionFormContext.useForm({
        initialValues: {
            id: uuid(),
            displayName: "",
            name: "",
        },
        validate: zodResolver(persistenceCallableFunctionSchema),
        transformValues: persistenceCallableFunctionSchema.parse,
    });

    const handleSubmit = form.onSubmit(async (values) => {
        const existingName = callableFunctions.find(
            (f) => f.id !== values.id && f.name === values.name
        );
        const existingDisplayName = callableFunctions.find(
            (f) =>
                f.id !== values.id &&
                getCallableFunctionDisplayName(f.id) === values.displayName
        );

        if (existingName) {
            form.setFieldError("name", "This name is already used");
        }

        if (existingDisplayName) {
            form.setFieldError(
                "displayName",
                "This display name is already used"
            );
        }

        if (existingName || existingDisplayName) return;
        await onSubmit(values);
    });

    React.useEffect(() => {
        if (id === form.values.id) return;
        const callableFunction = callableFunctions.find((f) => f.id === id);
        if (!callableFunction) return;
        form.setValues({
            ...callableFunction.toJSON(),
            displayName: getCallableFunctionDisplayName(callableFunction.id),
            code: getCallableFunctionCode(callableFunction.id),
        });
    }, [
        callableFunctions,
        form,
        getCallableFunctionCode,
        getCallableFunctionDisplayName,
        id,
    ]);

    return (
        <CallableFunctionFormContext.Provider form={form}>
            <form onSubmit={handleSubmit}>{children}</form>
        </CallableFunctionFormContext.Provider>
    );
};

export default CallableFunctionFormProvider;
