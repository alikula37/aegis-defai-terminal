import js from "@eslint/js";

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                console: "readonly",
                process: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                Buffer: "readonly",
                fetch: "readonly",
                URL: "readonly",
                AbortController: "readonly",
                global: "readonly",
            }
        },
        rules: {
            "no-unused-vars": ["warn", { "caughtErrors": "none", "argsIgnorePattern": "^_" }],
            "no-undef": "error",
            "no-empty": ["error", { "allowEmptyCatch": true }]
        }
    }
];
