import globals from "globals";
import tseslint from "typescript-eslint";
// import pluginJs from "@eslint/js"; // For base JS rules if needed separately

export default tseslint.config(
  // Configuration objects...
  { 
    // Applies to all files
    ignores: ["node_modules/", "**/dist/", "**/*.js", ".vscode/"], // Global ignores
  },
  // pluginJs.configs.recommended, // Base recommended JS rules (optional)
  ...tseslint.configs.recommended, // Recommended TypeScript rules
  // ...tseslint.configs.recommendedTypeChecking, // Optional: Slower rules requiring type info
  {
    // Custom rules for TypeScript files within src
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        // project: true, // Enable if using type-checking rules
        // tsconfigRootDir: import.meta.dirname + '/src',
      },
      globals: {
        ...globals.node, // Node.js global variables
      }
    },
    rules: {
      "no-console": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_+" }],
      "@typescript-eslint/no-explicit-any": "warn",
      // Add other rules here
    },
  }
); 