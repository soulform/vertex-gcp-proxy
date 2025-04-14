# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands
- Build: `npm run build` - Compiles TypeScript to JavaScript
- Start: `npm run start` - Runs the compiled app
- Dev: `npm run dev` - Runs the app with nodemon for development
- Lint: `npm run lint` - Runs ESLint on the codebase

## Code Style Guidelines
- **TypeScript**: Use strict typing with proper interfaces for requests/responses
- **Error Handling**: Use try/catch blocks with specific error logging
- **Naming**: Use camelCase for variables/functions, PascalCase for interfaces/types
- **Environment Variables**: Must match names in terraform/main.tf
- **Imports**: Group imports by type (built-in, external, internal)
- **Logging**: Use console.warn for warnings, console.error for errors
- **Formatting**: Follow existing indentation (2 spaces) and line breaks
- **Auth**: Always implement API key middleware for all routes except health checks

## Implementation Rules
- Follow the 7-phase plan for building the Vertex AI proxy service
- Implement features progressively and ensure cross-file consistency
- Properly configure Vertex AI client with environment variables
- Add explanatory comments for complex code blocks
- Use placeholders clearly for user-specific input