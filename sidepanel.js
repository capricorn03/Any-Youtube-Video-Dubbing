document.addEventListener('DOMContentLoaded', () => {
  const transcriptContainer = document.getElementById('transcriptContainer');
  const statusDiv = document.getElementById('status');
  const syncControlDiv = document.getElementById('syncControl');
  const syncToggle = document.getElementById('syncToggle');
  const copyBtn = document.getElementById('copyBtn');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const translateBtn = document.getElementById('translateBtn');

  // Check for missing DOM elements
  if (!transcriptContainer || !statusDiv || !syncControlDiv || !syncToggle || !copyBtn || !apiKeyInput || !translateBtn) {
    console.error("One or more required DOM elements are missing in sidepanel.html. Please check the HTML structure.");
    if (statusDiv) statusDiv.textContent = "Error: Side panel UI is not properly initialized.";
    return;
  }

  let fullTranscriptText = "";
  let transcriptSegmentsData = [];
  let currentVideoTime = 0;
  let isVideoPlaying = false;
  let activeSegmentElement = null;
  let timeSyncPort = null;
  let isSyncEnabled = true;
  let audioContext = new (window.AudioContext || window.webkitAudioContext)();
  let audioBuffers = [];
  let lastTimeUpdate = Date.now();
  let audioQueue = []; // Queue to manage audio playback

  function timestampToSeconds(timestamp) {
    const parts = timestamp.split(':').map(Number);
    let seconds = 0;
    if (parts.length === 3) {
      seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      seconds = parts[0] * 60 + parts[1];
    } else if (parts.length === 1) {
      seconds = parts[0];
    }
    return seconds;
  }

  async function translateText(text, apiKey) {
    if (!text) {
      throw new Error("No text provided for translation.");
    }
    if (text.length > 4000) {
      throw new Error("Text must be under 4,000 characters.");
    }

    const options = {
      method: "POST",
      url: "https://api.murf.ai/v1/text/translate",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      data: {
        targetLanguage: "hi-IN",
        texts: [text]
      }
    };
    try {
      const response = await fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: JSON.stringify(options.data)
      });
      const data = await response.json();
      console.log("Translation API response:", JSON.stringify(data, null, 2));
      if (!response.ok) {
        throw new Error(data.error?.message || data.error || `HTTP error! status: ${response.status}`);
      }
      if (data.translations && Array.isArray(data.translations) && data.translations[0]?.translated_text) {
        return data.translations[0].translated_text;
      } else {
        throw new Error("Translation failed: Invalid response structure");
      }
    } catch (error) {
      console.error("Translation error:", error.message, { text, apiKey: apiKey ? '[provided]' : '[missing]' });
      throw error;
    }
  }

  async function generateAudioStream(text, apiKey, retries = 3) {
    if (!text) {
      throw new Error("Text is empty or invalid.");
    }
    if (text.length > 1000) {
      throw new Error("Text exceeds 1,000 character limit for TTS.");
    }
    const sanitizedText = text.replace(/[\x00-\x1F\x7F]|\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDE4F\uDE80-\uDEFF]|\uD83E[\uDD00-\uDDFF]/gu, '').trim();
    if (!sanitizedText) {
      throw new Error("Sanitized text is empty.");
    }

    const apiUrl = "https://api.murf.ai/v1/speech/stream";
    let requestBody = {
      text: sanitizedText,
      voiceId: "hi-IN-ayushi",
      language: "hi-IN",
      format: "MP3"
    };

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`Generating audio for text: "${sanitizedText.slice(0, 50)}...", voice: ${requestBody.voiceId}, attempt: ${attempt}`);
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": apiKey
          },
          body: JSON.stringify(requestBody)
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = errorData.error?.message || data.error || `HTTP error! status: ${response.status}`;
          if (attempt < retries && response.status === 429) {
            console.warn(`Rate limit hit, retrying (${attempt}/${retries})...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          throw new Error(errorMessage);
        }
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        console.log(`Audio generated successfully, duration: ${audioBuffer.duration}s`);
        return audioBuffer;
      } catch (error) {
        console.error(`Audio generation error (attempt ${attempt}):`, error.message);
        if (attempt === retries) {
          if (requestBody.voiceId === "hi-IN-ayushi") {
            console.warn("Retrying with fallback voiceId: hi-IN-kabir");
            requestBody.voiceId = "hi-IN-kabir";
            attempt = 0;
            continue;
          } else if (requestBody.voiceId === "hi-IN-kabir") {
            console.warn("Retrying with default voiceId: hi-IN-shweta");
            requestBody.voiceId = "hi-IN-shweta";
            attempt = 0;
            continue;
          }
          throw error;
        }
      }
    }
  }

  async function translateAndGenerateAudio() {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      statusDiv.textContent = "Please enter a valid Murf API key.";
      console.error("API key missing");
      return;
    }
    if (transcriptSegmentsData.length === 0) {
      statusDiv.textContent = "No transcript available. Extract transcript first.";
      console.error("No transcript segments available");
      return;
    }

    audioContext.resume().then(() => {
      console.log("AudioContext resumed on translate button click, state:", audioContext.state);
    }).catch(err => console.error("AudioContext resume error on translate:", err));

    statusDiv.textContent = "Translating and generating audio...";
    audioBuffers = [];
    audioQueue = [];
    if (activeSegmentElement?.audioSource) {
      activeSegmentElement.audioSource.stop();
      activeSegmentElement.audioSource = null;
    }
    activeSegmentElement = null;

    let processedSegments = 0;
    const totalSegments = transcriptSegmentsData.length;

    for (let i = 0; i < totalSegments; i++) {
      try {
        const segment = transcriptSegmentsData[i];
        if (statusDiv) {
          statusDiv.textContent = `Processing segment ${i + 1} of ${totalSegments}...`;
        }

        console.log(`Segment ${i + 1} original text:`, segment.text);

        const translatedText = await translateText(segment.text, apiKey);
        console.log(`Segment ${i + 1} translated text:`, translatedText);

        const audioBuffer = await generateAudioStream(translatedText, apiKey);
        audioBuffers.push({
          startSeconds: segment.startSeconds,
          duration: audioBuffer.duration,
          buffer: audioBuffer,
          element: segment.element
        });

        segment.element.querySelector('.text').textContent = translatedText;
        fullTranscriptText = fullTranscriptText.replace(segment.text, translatedText);
        segment.text = translatedText;

        processedSegments++;
      } catch (error) {
        console.error(`Error processing segment ${i + 1}:`, error.message);
        if (statusDiv) {
          statusDiv.textContent = `Error in segment ${i + 1}: ${error.message}. Continuing with next segment.`;
        }
      }
    }

    audioBuffers.sort((a, b) => a.startSeconds - b.startSeconds);

    if (statusDiv) {
      if (processedSegments === totalSegments) {
        statusDiv.textContent = "Translation and audio generation complete!";
        console.log("All segments processed successfully, audioBuffers:", audioBuffers.length);
      } else {
        statusDiv.textContent = `Completed ${processedSegments} of ${totalSegments} segments. Check console for errors.`;
        console.warn(`Processed ${processedSegments}/${totalSegments} segments`);
      }
    }
  }

  function playAudioForCurrentTime() {
    if (!isSyncEnabled || !isVideoPlaying || audioBuffers.length === 0) {
      if (activeSegmentElement?.audioSource) {
        activeSegmentElement.audioSource.stop();
        activeSegmentElement.audioSource = null;
        activeSegmentElement.element.classList.remove('active');
        activeSegmentElement = null;
      }
      audioQueue = [];
      console.log("Audio playback skipped: sync disabled, video paused, or no audio buffers");
      return;
    }

    // Find the segment closest to the current video time
    let nextAudio = null;
    for (let i = 0; i < audioBuffers.length; i++) {
      const diff = Math.abs(currentVideoTime - audioBuffers[i].startSeconds);
      if (diff < 2) {
        nextAudio = audioBuffers[i];
        console.log(`Matched segment at ${nextAudio.startSeconds}s, time diff: ${diff.toFixed(2)}s`);
        break;
      }
    }

    if (nextAudio) {
      // Add to queue if not already present
      if (!audioQueue.some(item => item.startSeconds === nextAudio.startSeconds)) {
        audioQueue.push(nextAudio);
        console.log(`Added segment at ${nextAudio.startSeconds}s to audio queue, queue length: ${audioQueue.length}`);
      }
    }

    // If audio is currently playing, do nothing and let the queue handle the next segment
    if (activeSegmentElement?.audioSource) {
      console.log(`Audio for segment at ${activeSegmentElement.startSeconds}s is still playing, duration: ${activeSegmentElement.buffer.duration}s`);
      return;
    }

    // Play the next audio in the queue
    if (audioQueue.length > 0) {
      const currentAudio = audioQueue.shift();
      console.log(`Preparing audio for segment at ${currentAudio.startSeconds}s, AudioContext state: ${audioContext.state}`);

      audioContext.resume().then(() => {
        console.log("AudioContext resumed, state:", audioContext.state);
        try {
          const source = audioContext.createBufferSource();
          source.buffer = currentAudio.buffer;
          source.connect(audioContext.destination);
          source.start(0);
          source.onended = () => {
            console.log(`Audio for segment at ${currentAudio.startSeconds}s completed`);
            if (activeSegmentElement?.element === currentAudio.element) {
              activeSegmentElement.element.classList.remove('active');
              activeSegmentElement = null;
              if (isVideoPlaying && isSyncEnabled) {
                playAudioForCurrentTime(); // Play next audio in queue
              }
            }
          };

          activeSegmentElement = {
            element: currentAudio.element,
            audioSource: source,
            startSeconds: currentAudio.startSeconds,
            buffer: currentAudio.buffer
          };
          activeSegmentElement.element.classList.add('active');
          activeSegmentElement.element.scrollIntoView({ behavior: 'smooth', block: 'center' });

          console.log(`Playing audio for segment at ${currentAudio.startSeconds}s, duration: ${currentAudio.duration}s`);
        } catch (err) {
          console.error("Audio playback error:", err);
          activeSegmentElement = null;
          playAudioForCurrentTime(); // Try next audio in case of error
        }
      }).catch(err => {
        console.error("AudioContext resume error:", err);
        activeSegmentElement = null;
        playAudioForCurrentTime(); // Try next audio in case of error
      });
    } else {
      console.log(`No audio segment found for current video time: ${currentVideoTime}s`);
    }
  }

  function renderTranscript(segments) {
    transcriptContainer.innerHTML = '';
    transcriptSegmentsData = [];
    fullTranscriptText = "";
    let segmentIdCounter = 0;

    if (!segments || segments.length === 0) {
      transcriptContainer.textContent = 'No transcript segments found.';
      syncControlDiv.style.display = 'none';
      return;
    }

    segments.forEach(segment => {
      const segmentDiv = document.createElement('div');
      segmentDiv.classList.add('transcript-segment');
      segmentDiv.id = `segment-${segmentIdCounter++}`;

      const timestampSpan = document.createElement('span');
      timestampSpan.classList.add('timestamp');
      timestampSpan.textContent = segment.timestamp;
      segmentDiv.appendChild(timestampSpan);

      const textSpan = document.createElement('span');
      textSpan.classList.add('text');
      textSpan.textContent = segment.text;
      segmentDiv.appendChild(textSpan);

      segmentDiv.addEventListener('click', () => {
        const seconds = timestampToSeconds(segment.timestamp);
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: "seekTo",
              time: seconds
            });
          }
        });
      });

      transcriptContainer.appendChild(segmentDiv);

      transcriptSegmentsData.push({
        timestamp: segment.timestamp,
        text: segment.text,
        startSeconds: timestampToSeconds(segment.timestamp),
        element: segmentDiv
      });

      fullTranscriptText += `${segment.timestamp}\n${segment.text}\n\n`;
    });
    syncControlDiv.style.display = 'block';
    copyBtn.style.display = 'inline-block';
    statusDiv.textContent = 'Transcript extracted!';
    updateActiveSegment();
  }

  function updateActiveSegment() {
    if (!isSyncEnabled || transcriptSegmentsData.length === 0) {
      if (activeSegmentElement) {
        activeSegmentElement.element.classList.remove('active');
        if (activeSegmentElement.audioSource) {
          activeSegmentElement.audioSource.stop();
          activeSegmentElement.audioSource = null;
        }
        activeSegmentElement = null;
      }
      return;
    }

    let newActiveSegment = null;
    for (let i = 0; i < transcriptSegmentsData.length; i++) {
      if (Math.abs(currentVideoTime - transcriptSegmentsData[i].startSeconds) < 2) {
        newActiveSegment = transcriptSegmentsData[i].element;
        break;
      }
    }

    if (newActiveSegment && newActiveSegment !== activeSegmentElement?.element) {
      if (activeSegmentElement) {
        activeSegmentElement.element.classList.remove('active');
        if (activeSegmentElement.audioSource) {
          activeSegmentElement.audioSource.stop();
          activeSegmentElement.audioSource = null;
        }
      }
      newActiveSegment.classList.add('active');
      activeSegmentElement = { element: newActiveSegment };
      activeSegmentElement.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (!newActiveSegment && activeSegmentElement && !activeSegmentElement.audioSource) {
      activeSegmentElement.element.classList.remove('active');
      activeSegmentElement = null;
    }

    if (isVideoPlaying) {
      playAudioForCurrentTime();
    }
  }

  function connectToContentScript() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        if (timeSyncPort) {
          try { timeSyncPort.disconnect(); } catch (e) {}
        }
        timeSyncPort = chrome.tabs.connect(tabs[0].id, { name: "transcriptSync" });
        timeSyncPort.onMessage.addListener((msg) => {
          if (msg.action === "videoTimeUpdate") {
            if (typeof msg.time !== 'number' || isNaN(msg.time)) {
              console.error("Invalid video time received:", msg.time);
              return;
            }
            currentVideoTime = msg.time;
            isVideoPlaying = !!msg.isPlaying;
            lastTimeUpdate = Date.now();

            console.log(`Video time update: ${currentVideoTime.toFixed(2)}s, playing: ${isVideoPlaying}`);

            if (isSyncEnabled) {
              if (!isVideoPlaying && activeSegmentElement?.audioSource) {
                console.log("Video paused, stopping audio");
                activeSegmentElement.audioSource.stop();
                activeSegmentElement.audioSource = null;
                activeSegmentElement.element.classList.remove('active');
                activeSegmentElement = null;
                audioQueue = [];
              }
              updateActiveSegment();
            }
          } else {
            console.warn("Unexpected message action:", msg.action);
          }
        });
        timeSyncPort.onDisconnect.addListener(() => {
          console.log("Side panel port disconnected.");
          timeSyncPort = null;
          if (chrome.runtime.lastError) {
            console.log("Side panel port disconnect error:", chrome.runtime.lastError.message);
          }
        });

        setInterval(() => {
          if (Date.now() - lastTimeUpdate > 2000 && tabs[0]?.id) {
            console.warn("No recent video time updates, requesting...");
            chrome.tabs.sendMessage(tabs[0].id, { action: "requestTimeUpdate" });
          }
        }, 3000);
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "updateTranscript") {
      renderTranscript(message.transcript);
      if (message.transcript.length > 0) {
        isSyncEnabled = syncToggle.checked;
        if (isSyncEnabled) {
          connectToContentScript();
        }
      }
    }
  });

  copyBtn.addEventListener('click', () => {
    if (fullTranscriptText) {
      navigator.clipboard.writeText(fullTranscriptText.trim())
        .then(() => {
          statusDiv.textContent = 'Transcript copied to clipboard!';
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy to Clipboard'; }, 2000);
        })
        .catch(err => {
          console.error('Failed to copy transcript:', err);
          statusDiv.textContent = 'Failed to copy.';
        });
    }
  });

  syncToggle.addEventListener('change', (event) => {
    isSyncEnabled = event.target.checked;
    if (isSyncEnabled) {
      if (!timeSyncPort && transcriptSegmentsData.length > 0) {
        connectToContentScript();
      }
      updateActiveSegment();
    } else {
      if (activeSegmentElement) {
        activeSegmentElement.element.classList.remove('active');
        if (activeSegmentElement.audioSource) {
          activeSegmentElement.audioSource.stop();
          activeSegmentElement.audioSource = null;
        }
        activeSegmentElement = null;
      }
      audioQueue = [];
    }
  });

  translateBtn.addEventListener('click', translateAndGenerateAudio);
});