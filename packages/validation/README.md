# @smart-hr/validation

Zod schemas shared by web forms and API endpoints, so both sides apply the same rules.
The API remains the authority: it validates every request with these schemas and adds checks the browser
cannot do (password block list, uniqueness, permissions).
