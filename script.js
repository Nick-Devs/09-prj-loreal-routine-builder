/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
// New references for selection UI
const selectedProductsList = document.getElementById("selectedProductsList");
const generateRoutineBtn = document.getElementById("generateRoutine");

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

/* In-memory state */
// Array of selected product objects
const selectedProducts = [];
// Currently displayed products (last filter result) so we can re-render after toggling
let currentProducts = [];

/* Conversation state for chat follow-ups */
// System instruction stays at the start so the assistant behaves as a beauty advisor.
// --> KEEP THIS FOR API ONLY, DO NOT SHOW IN CHAT UI
const systemMessage = {
  role: "system",
  content:
    "You are a helpful beauty advisor that creates concise, step-by-step routines and answers follow-up questions about the generated routine and related topics (skincare, haircare, makeup, fragrance, suncare). Use only the context provided in the conversation when answering.",
};

// Split conversation into API vs visible transcripts:
// - conversationAPI includes systemMessage and any JSON payloads sent to the worker.
// - conversationVisible is what is rendered in the chat window (never includes the system message or raw JSON).
const conversationAPI = [systemMessage];
const conversationVisible = []; // start empty so systemMessage is not shown

/* Utility: render the full conversation in the chat window (simple text view) */
/* Render only conversationVisible so the system instruction and raw JSON never appear */
function renderChatWindow() {
  const lines = conversationVisible.map((m) => {
    if (m.role === "user") return `You: ${m.content}`;
    if (m.role === "assistant") return `Advisor: ${m.content}`;
    return `System: ${m.content}`; // won't be used because systemMessage is kept out of conversationVisible
  });
  chatWindow.innerText = lines.join("\n\n");
}

/* Utility: simple allowed topic check for follow-up questions */
function isAllowedQuestion(text) {
  const allowed = [
    "skincare",
    "haircare",
    "makeup",
    "fragrance",
    "suncare",
    "routine",
    "product",
    "spf",
    "retinol",
    "hyaluronic",
    "cleanser",
    "moisturizer",
    "serum",
    "sunscreen",
    "acne",
    "hydration",
    "conditioner",
    "shampoo",
    "hair",
    "skin",
    "eye",
    "lips",
    "mask",
  ];
  const lower = (text || "").toLowerCase();
  // Allow questions that contain any allowed keyword
  return allowed.some((kw) => lower.includes(kw));
}

/* Generic: send messages array to the Cloudflare Worker, return assistant text */
async function callWorker(messages) {
  // Worker URL: allow override via secrets.js (window.OPENAI_WORKER_URL)
  const workerUrl =
    window.OPENAI_WORKER_URL ||
    "https://gca-loreal-worker.nhoekstr.workers.dev/";

  if (!workerUrl) {
    throw new Error(
      "Missing worker URL. Set window.OPENAI_WORKER_URL in secrets.js or edit the code."
    );
  }

  // Send request to the Cloudflare Worker. The worker is responsible for using the OpenAI API key.
  const resp = await fetch(workerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages,
      max_tokens: 600,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Worker error: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  // Expect worker to forward OpenAI response structure
  const aiContent =
    data?.choices?.[0]?.message?.content || data?.result || null;
  if (!aiContent) throw new Error("No content returned from worker/OpenAI.");
  return aiContent;
}

/* Create HTML for displaying product cards */
// We add data-id, an 'info' button to toggle description, and a 'selected' class when an item is in selectedProducts
function displayProducts(products) {
  if (!products || products.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">No products found for this category</div>
    `;
    return;
  }

  productsContainer.innerHTML = products
    .map((product) => {
      const isSelected = selectedProducts.some((p) => p.id === product.id);
      // card includes an info button and a hidden description area
      return `
    <div class="product-card ${isSelected ? "selected" : ""}" data-id="${
        product.id
      }">
      <div class="card-media">
        <img src="${product.image}" alt="${product.name}">
        <button class="info-btn" aria-label="Toggle details" data-id="${
          product.id
        }">i</button>
      </div>
      <div class="product-info">
        <h3>${product.name}</h3>
        <p>${product.brand}</p>
        <div class="product-desc" hidden>${product.description}</div>
      </div>
    </div>
  `;
    })
    .join("");
}

/* Update the Selected Products section */
function updateSelectedProductsList() {
  // Show placeholder if none selected
  if (selectedProducts.length === 0) {
    selectedProductsList.innerHTML = `
      <p class="placeholder-message">No products selected</p>
    `;
    return;
  }

  // Render each selected product with a remove button
  selectedProductsList.innerHTML = selectedProducts
    .map(
      (p) => `
    <div class="selected-item" data-id="${p.id}">
      <span class="selected-name">${p.name}</span>
      <button class="remove-btn" data-id="${p.id}" aria-label="Remove ${p.name}">&times;</button>
    </div>
  `
    )
    .join("");
}

/* Filter and display products when category changes */
categoryFilter.addEventListener("change", async (e) => {
  const products = await loadProducts();
  const selectedCategory = e.target.value;

  /* filter() creates a new array containing only products 
     where the category matches what the user selected */
  const filteredProducts = products.filter(
    (product) => product.category === selectedCategory
  );

  // Update currentProducts so toggles re-render correctly
  currentProducts = filteredProducts;
  displayProducts(filteredProducts);
});

/* Allow selecting/unselecting a product by clicking its card,
   and toggling the description when the info button is clicked. */
productsContainer.addEventListener("click", async (e) => {
  // If user clicked the info button (or its children), toggle the description and stop
  const infoBtn = e.target.closest(".info-btn");
  if (infoBtn) {
    const card = infoBtn.closest(".product-card");
    if (!card) return;
    const desc = card.querySelector(".product-desc");
    if (!desc) return;
    const isHidden = desc.hasAttribute("hidden");
    if (isHidden) {
      desc.removeAttribute("hidden");
      infoBtn.setAttribute("aria-pressed", "true");
    } else {
      desc.setAttribute("hidden", "");
      infoBtn.setAttribute("aria-pressed", "false");
    }
    return;
  }

  // Otherwise, handle selection toggling when the user clicks the card area (not the info button)
  const card = e.target.closest(".product-card");
  if (!card) return;

  const id = parseInt(card.dataset.id, 10);
  if (Number.isNaN(id)) return;

  // Ensure we have product details (load if needed)
  const allProducts = await loadProducts();
  const product = allProducts.find((p) => p.id === id);
  if (!product) return;

  // Toggle selection
  const idx = selectedProducts.findIndex((p) => p.id === id);
  if (idx > -1) {
    selectedProducts.splice(idx, 1);
  } else {
    selectedProducts.push(product);
  }

  // persist changes
  saveSelectedProducts();

  // re-render both list and grid
  updateSelectedProductsList();
  displayProducts(currentProducts.length ? currentProducts : allProducts);
});

/* Event delegation on the selectedProductsList container */
selectedProductsList.addEventListener("click", (e) => {
  if (!e.target.classList.contains("remove-btn")) return;
  const id = parseInt(e.target.dataset.id, 10);
  if (Number.isNaN(id)) return;

  const idx = selectedProducts.findIndex((p) => p.id === id);
  if (idx > -1) selectedProducts.splice(idx, 1);

  // persist changes
  saveSelectedProducts();

  updateSelectedProductsList();
  // Re-render grid so a removed item loses its "selected" visual
  displayProducts(currentProducts);
});

/* Hook up Generate Routine button (send full JSON to conversationAPI, show sanitized summary in conversationVisible) */
generateRoutineBtn.addEventListener("click", async () => {
  // Only send selected products
  if (selectedProducts.length === 0) {
    chatWindow.innerText =
      "Please select one or more products before generating a routine.";
    return;
  }

  // Prepare minimal product objects for the API (full JSON)
  const productsForAI = selectedProducts.map((p) => ({
    name: p.name,
    brand: p.brand,
    category: p.category,
    description: p.description,
  }));

  // Visible summary for the user (no JSON)
  const visibleSummary = {
    role: "user",
    content:
      `Submitted ${selectedProducts.length} product(s) for routine generation: ` +
      selectedProducts.map((p) => `${p.name} (${p.brand})`).join(", "),
  };
  conversationVisible.push(visibleSummary);
  renderChatWindow();

  // Full API message (contains JSON) — only goes to conversationAPI
  const apiUserMessage = {
    role: "user",
    content:
      "Here is an array of selected products (only name, brand, category, description). Using only these products, generate a short personalized morning and/or evening routine (numbered steps). Include a brief rationale for each step. Return plain text.\n\nProducts:\n" +
      JSON.stringify(productsForAI, null, 2),
  };
  conversationAPI.push(apiUserMessage);

  // UI: show loading
  generateRoutineBtn.disabled = true;
  chatWindow.innerText = "Generating routine…";

  try {
    // Send conversationAPI (system + full context) to worker
    const assistantText = await callWorker(conversationAPI);

    const assistantMsg = { role: "assistant", content: assistantText };
    // Save assistant reply into BOTH arrays (assistant text is safe to show)
    conversationAPI.push(assistantMsg);
    conversationVisible.push(assistantMsg);
    renderChatWindow();
  } catch (err) {
    const errorMsg = {
      role: "assistant",
      content: `Error generating routine: ${err.message}`,
    };
    conversationAPI.push(errorMsg);
    conversationVisible.push(errorMsg);
    renderChatWindow();
  } finally {
    generateRoutineBtn.disabled = false;
  }
});

/* Chat form submission handler - sends follow-up questions with conversation memory */
/* Append user queries to BOTH conversationAPI (for context) and conversationVisible (for UI) */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("userInput");
  const text = (input.value || "").trim();
  if (!text) return;

  // Basic topic filtering to keep the chat on-scope
  if (!isAllowedQuestion(text)) {
    chatWindow.innerText =
      "Please ask about the generated routine or topics like skincare, haircare, makeup, fragrance, suncare, or related product questions.";
    return;
  }

  const userMsgForAPI = { role: "user", content: text };
  const userMsgVisible = { role: "user", content: text };

  // Append to both arrays
  conversationAPI.push(userMsgForAPI);
  conversationVisible.push(userMsgVisible);
  renderChatWindow();

  // Clear input and show loading
  input.value = "";
  chatWindow.innerText = "Thinking…";

  try {
    const assistantText = await callWorker(conversationAPI);
    const assistantMsg = { role: "assistant", content: assistantText };
    conversationAPI.push(assistantMsg);
    conversationVisible.push(assistantMsg);
    renderChatWindow();
  } catch (err) {
    const errMsg = { role: "assistant", content: `Error: ${err.message}` };
    conversationAPI.push(errMsg);
    conversationVisible.push(errMsg);
    renderChatWindow();
  }
});

/* Initialize chat UI (do not render system message) */
renderChatWindow();

// New: wire Clear All button and restore saved selections on load
// Wait for DOM + product data to be available
document.addEventListener("DOMContentLoaded", async () => {
  // attempt to restore selections (loads products.json if needed)
  await restoreSelections();

  // wire clear button if present (index.html adds it)
  const clearBtn = document.getElementById("clearSelections");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      clearAllSelections();
    });
  }
});

/* New: storage key and optional cached products */
const STORAGE_KEY = "selectedProductIds";
let allProductsCache = null;

/* Load product data from JSON file */
async function loadProducts() {
  if (allProductsCache) return allProductsCache;
  const response = await fetch("products.json");
  const data = await response.json();
  allProductsCache = data.products;
  return allProductsCache;
}

// New: save selected product IDs to localStorage
function saveSelectedProducts() {
  try {
    const ids = selectedProducts.map((p) => p.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch (err) {
    // ignore storage errors for now
    console.warn("Could not save selections", err);
  }
}

// New: restore selected products from storage (populate selectedProducts array with full product objects)
async function restoreSelections() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      updateSelectedProductsList();
      return;
    }
    const ids = JSON.parse(raw || "[]");
    if (!Array.isArray(ids) || ids.length === 0) {
      updateSelectedProductsList();
      return;
    }
    const products = await loadProducts();
    // Clear current selection then push found products
    selectedProducts.length = 0;
    ids.forEach((id) => {
      const p = products.find((x) => x.id === id);
      if (p) selectedProducts.push(p);
    });
    updateSelectedProductsList();
  } catch (err) {
    console.warn("Could not restore selections", err);
    updateSelectedProductsList();
  }
}

// New: clear all selections (UI + storage)
function clearAllSelections() {
  selectedProducts.length = 0;
  saveSelectedProducts();
  updateSelectedProductsList();
  // re-render grid to remove selected visuals (use currentProducts or all)
  displayProducts(
    currentProducts.length ? currentProducts : allProductsCache || []
  );
}
