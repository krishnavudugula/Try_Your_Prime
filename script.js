/* =====================================================
   TRY YOUR PRIME — script.js
   OpenRouter API · Live Metrics · Reveal Animations
   ===================================================== */

// ── CONFIG ────────────────────────────────────────────
// API endpoint — calls your backend, which securely handles the OpenRouter API key
const API_ENDPOINT = "/api/chat";

const TOTAL_QUESTIONS = 8;

// ── DOM REFERENCES ────────────────────────────────────
const isChatPage = !!document.getElementById("chatWindow");

// ── LANDING PAGE: scroll reveal ───────────────────────
if (!isChatPage) {
  const observer = new IntersectionObserver(
    (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("visible"); }),
    { threshold: 0.08 }
  );
  document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));

  // Hero reveals immediately on load
  document.querySelectorAll(".hero .reveal").forEach((el, i) => {
    setTimeout(() => el.classList.add("visible"), 80 + i * 120);
  });
}

// ── CHAT PAGE ─────────────────────────────────────────
if (isChatPage) {
  const chatWindow      = document.getElementById("chatWindow");
  const typingIndicator = document.getElementById("typingIndicator");
  const chatForm        = document.getElementById("chatForm");
  const chatInput       = document.getElementById("chatInput");
  const cancelBtn       = document.getElementById("cancelBtn");
  const quickPicks      = document.getElementById("quickPicks");
  const progressLabel   = document.getElementById("progressLabel");

  // Sidebar metric elements
  const elGoal          = document.getElementById("liveGoal");
  const elGoalBar       = document.getElementById("goalProgress");
  const elDistance      = document.getElementById("distanceMetric");
  const elRisk          = document.getElementById("liveRisk");
  const elRiskDetail    = document.getElementById("liveRiskDetail");
  const elFuture        = document.getElementById("liveFuture");
  const elFutureDetail  = document.getElementById("liveFutureDetail");

  const prefersReduced  = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Conversation history sent to the API each turn
  const messages = [];
  let questionNumber = 0;
  
  // Abort controller for cancelling requests
  let currentAbortController = null;

  // ── Helpers ──────────────────────────────────────────

  const scrollDown = () => {
    if (prefersReduced) {
      chatWindow.scrollTop = chatWindow.scrollHeight;
    } else {
      chatWindow.scrollTo({ top: chatWindow.scrollHeight, behavior: "smooth" });
    }
  };

  /** Append a message bubble + avatar to the chat window */
  const appendMessage = (text, role = "assistant") => {
    const wrap = document.createElement("div");
    wrap.className = `chat-message ${role}`;

    const avatar = document.createElement("div");
    avatar.className = role === "assistant" ? "msg-avatar ai-avatar" : "msg-avatar user-avatar";
    avatar.textContent = role === "assistant" ? "AI" : "You";

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = text;

    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
    chatWindow.appendChild(wrap);
    scrollDown();
    return wrap;
  };

  /** Show / hide the typing indicator */
  const setTyping = (show) => {
    typingIndicator.hidden = !show;
    if (show) scrollDown();
  };

  /** Update the live analysis sidebar */
  const updateMetrics = (data) => {
    if (data.liveGoal)         elGoal.textContent        = data.liveGoal;
    if (data.goalProgress !== undefined) {
      const pct = Math.max(5, Math.min(100, data.goalProgress));
      elGoalBar.style.width = `${pct}%`;
    }
    if (data.distanceMetric)   elDistance.textContent    = `Distance: ${data.distanceMetric}`;
    if (data.liveRisk)         elRisk.textContent         = data.liveRisk;
    if (data.liveRiskDetail)   elRiskDetail.textContent   = data.liveRiskDetail;
    if (data.liveFuture)       elFuture.textContent       = data.liveFuture;
    if (data.liveFutureDetail) elFutureDetail.textContent = data.liveFutureDetail;

    if (data.questionNumber !== undefined) {
      const q = Math.min(data.questionNumber, TOTAL_QUESTIONS);
      progressLabel.textContent = `${q} / ${TOTAL_QUESTIONS}`;
      questionNumber = q;
    }
  };

  /** Render quick-reply chips */
  const renderChips = (options = []) => {
    quickPicks.innerHTML = "";
    options.forEach((label) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "quick-reply";
      chip.textContent = label;
      chip.addEventListener("click", () => {
        quickPicks.innerHTML = "";
        handleSend(label);
      });
      quickPicks.appendChild(chip);
    });
  };

  // ── API Call ──────────────────────────────────────────
  // Call the backend /api/chat endpoint with abort capability

  const callBackendAPI = async (messages, abortSignal) => {
    const resp = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: messages
      }),
      signal: abortSignal
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Backend ${resp.status}: ${err}`);
    }

    const data = await resp.json();
    return data;
  };

  // ── Send Handler ──────────────────────────────────────

  const handleSend = async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Disable input during request
    chatInput.value = "";
    chatInput.disabled = true;
    chatForm.querySelector("button").disabled = true;
    cancelBtn.style.display = "inline-block";  // Show cancel button
    quickPicks.innerHTML = "";

    appendMessage(trimmed, "user");
    messages.push({ role: "user", content: trimmed });

    setTyping(true);

    // Create new abort controller for this request
    currentAbortController = new AbortController();

    try {
      const parsed = await callBackendAPI(messages, currentAbortController.signal);

      setTyping(false);

      // Update sidebar metrics
      updateMetrics(parsed);

      // Show AI reply
      const reply = parsed.chatResponse || "I'm processing your response…";
      appendMessage(reply, "assistant");
      messages.push({ role: "assistant", content: reply });

      // If assessment is complete, offer restart
      if (questionNumber >= TOTAL_QUESTIONS) {
        renderChips(["Start over"]);
      }

    } catch (err) {
      setTyping(false);
      console.error("Prime Engine error:", err);

      // Don't show error if request was aborted
      if (err.name === "AbortError") {
        appendMessage("Request cancelled. Try again.", "assistant");
      } else {
        const isKeyError = err.message?.includes("401") || err.message?.includes("403") || err.message?.includes("GROQ_API_KEY");
        const errorMsg = isKeyError
          ? "API key issue — check GROQ_API_KEY in .env file."
          : "The engine couldn't connect. Check your backend is running and try again.";

        appendMessage(errorMsg, "assistant");
      }
    } finally {
      chatInput.disabled = false;
      chatForm.querySelector("button").disabled = false;
      cancelBtn.style.display = "none";  // Hide cancel button
      chatInput.focus();
      currentAbortController = null;
    }
  };

  // ── Event Listeners ───────────────────────────────────

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    handleSend(chatInput.value);
  });

  chatInput.addEventListener("keydown", (e) => {
    // Shift+Enter = newline (if textarea); Enter alone = submit
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(chatInput.value);
    }
  });

  cancelBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (currentAbortController) {
      currentAbortController.abort();
    }
  });

  // ── Init ──────────────────────────────────────────────

  const OPENING = "Be honest with me and I'll tell you who you'll likely become in the next few years. I need to know your daily habits, your goals, and what you've been doing with your time. Let's start : what is your primary goal for the next few years?";

  appendMessage(OPENING, "assistant");
  messages.push({ role: "assistant", content: OPENING });
  progressLabel.textContent = `0 / ${TOTAL_QUESTIONS}`;
  chatInput.focus();
}