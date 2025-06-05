document.addEventListener('DOMContentLoaded', () => {
  const extractBtn = document.getElementById('extractBtn');
  const statusDiv = document.getElementById('status');

  extractBtn.addEventListener('click', async () => {
    statusDiv.textContent = 'Extracting...';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tab && tab.url && tab.url.includes("youtube.com/watch")) {
        // Open the side panel
        await chrome.sidePanel.open({ windowId: tab.windowId });

        chrome.tabs.sendMessage(tab.id, { action: "extractTranscript" }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Error sending message:", chrome.runtime.lastError.message);
            statusDiv.textContent = "Error: Could not communicate with the YouTube page. Refresh & try again.";
            return;
          }

          if (response && response.transcript) {
            // Send transcript to side panel
            chrome.runtime.sendMessage({
              action: "updateTranscript",
              transcript: response.transcript
            });
            statusDiv.textContent = 'Transcript extracted! Check the side panel.';
          } else if (response && response.error) {
            statusDiv.textContent = `Error: ${response.error}`;
          } else {
            statusDiv.textContent = 'Failed to extract transcript. Ensure transcript panel is open or can be opened.';
          }
        });
      } else {
        statusDiv.textContent = 'Not a YouTube video page.';
      }
    } catch (error) {
      console.error("Popup script error:", error);
      statusDiv.textContent = "An unexpected error occurred.";
    }
  });
});