# Search

One search box in the header of the web app finds people, projects, work items, assets and stock items.

- **API:** `GET /v1/search?q=<text>` (two or more characters; shorter returns an empty list). Up to five results per group.
- **Same rules as the pages:** each group is read through the module's own service, role check and visibility scope, so a result is always something the person could already open. A group the person's role or the plan doesn't include is left out, never an error.
- **What is matched:** people by name, code or work email; projects by name, code or client; work items by title (across up to 20 workspaces the person can see); assets by tag, name or serial number; stock items by name or SKU.
- **Not searched:** sensitive employee details, money figures, comments or document contents.
- **Web:** results are grouped and open the matching page; Enter opens the first result and Escape closes the list.
