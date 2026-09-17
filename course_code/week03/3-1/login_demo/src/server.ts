import { createApp } from "./app";

const port = 3001;
const app = createApp();

app.listen(port, () => {
  console.log(`login_demo listening on http://localhost:${port}`);
});
