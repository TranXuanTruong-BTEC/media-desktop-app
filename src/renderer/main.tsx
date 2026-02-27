import { createRoot } from "react-dom/client";
import App from "./App.js";
import "./index.css";
createRoot(document.getElementById("root")!).render(<App />);
const container = document.getElementById("root")!;
createRoot(container).render(<App />);