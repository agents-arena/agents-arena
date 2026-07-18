// Entry point. Importing `@agents-arena/ui` registers every shared custom
// element (side-effect of the @customElement decorators). Importing `./app.js`
// registers <arena-server-app> and, transitively, the pages, the watch board,
// and the SSE controller.
import '@agents-arena/ui';
import './app.js';
