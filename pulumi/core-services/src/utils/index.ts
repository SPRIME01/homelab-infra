import * as pulumi from "@pulumi/pulumi";

/**
 * Create a resource name with a consistent format
 */
export function createResourceName(
    baseName: string,
    suffix?: string
): string {
    const stack = pulumi.getStack();
    return suffix
        ? `${baseName}-${stack}-${suffix}`
        : `${baseName}-${stack}`;
}

/**
 * Format error messages consistently
 */
export function formatError(message: string, err: any): string {
    return `Error: ${message}. Details: ${err}`;
}
