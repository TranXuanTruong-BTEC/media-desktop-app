import { useState } from "react";

declare global {
  interface Window {
    api: {
      download: (url: string) => Promise<string>;
    };
  }
}

function App() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");

  const handleDownload = async () => {
    if (!url) return;

    setStatus("Downloading...");
    try {
      const res = await window.api.download(url);
      setStatus(res);
    } catch (err) {
      setStatus("Error downloading");
    }
  };

  return (
    <div style={{ padding: 40 }}>
      <h2>Media Downloader</h2>

      <input
        style={{ width: "80%" }}
        placeholder="Paste YouTube link"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />

      <br /><br />

      <button onClick={handleDownload}>
        Download
      </button>

      <p>{status}</p>
    </div>
  );
}

export default App;