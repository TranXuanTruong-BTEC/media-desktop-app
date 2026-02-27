interface Window {
  electronAPI: {
    download: (url: string) => Promise<any>;
  };
}