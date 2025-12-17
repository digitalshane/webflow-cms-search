"use strict";
(() => {
  // src/client/search.ts
  (function () {
    function debounce(fn, ms) {
      let timeoutId;
      return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), ms);
      };
    }
    function initSearch() {
      const searchInput = document.querySelector('[data-tag="search"]');
      const resultsContainer = document.querySelector('[data-tag="results"]');
      const resultTemplate = document.querySelector(
        '[data-tag="results-item"]'
      );
      if (!searchInput) {
        console.warn("Webflow Search: No element with data-tag='search' found");
        return;
      }
      if (!resultsContainer) {
        console.warn(
          "Webflow Search: No element with data-tag='results' found"
        );
        return;
      }
      if (!resultTemplate) {
        console.warn(
          "Webflow Search: No element with data-tag='results-item' found"
        );
        return;
      }
      const apiUrl =
        searchInput.getAttribute("data-api-url") || window.location.origin;
      const scope = searchInput.getAttribute("data-scope") || "all";
      const collections = searchInput.getAttribute("data-collections") || "";
      const debounceMs = parseInt(
        searchInput.getAttribute("data-debounce") || "300",
        10
      );
      if (!collections) {
        console.error(
          "Webflow Search: data-collections attribute is required on search input"
        );
        return;
      }
      resultTemplate.style.display = "none";
      const config = {
        apiUrl,
        collections:
          scope === "all"
            ? collections
            : collections.split(",").find((c) => c.trim() === scope) ||
              collections,
        debounceMs,
      };
      async function performSearch(query) {
        if (!query.trim()) {
          clearResults();
          return;
        }
        try {
          const url = new URL("/app/api/search", config.apiUrl);
          url.searchParams.set("q", query);
          url.searchParams.set("collections", config.collections);
          const response = await fetch(url.toString());
          if (!response.ok) {
            throw new Error(`Search failed: ${response.status}`);
          }
          const data = await response.json();
          renderResults(data.results);
        } catch (error) {
          console.error("Webflow Search error:", error);
          clearResults();
        }
      }
      function clearResults() {
        if (!resultsContainer || !resultTemplate) return;
        const children = Array.from(resultsContainer.children);
        children.forEach((child) => {
          if (child !== resultTemplate) {
            child.remove();
          }
        });
      }
      function renderResults(results) {
        if (!resultsContainer || !resultTemplate) return;
        clearResults();
        if (results.length === 0) {
          return;
        }
        results.forEach((result) => {
          const item = resultTemplate.cloneNode(true);
          item.style.display = "";
          item.removeAttribute("data-tag");
          const titleEl = item.querySelector('[data-tag="results-title"]');
          if (titleEl) {
            titleEl.textContent = result.name;
          }
          const linkEl = item.querySelector('[data-tag="results-link"]');
          if (linkEl) {
            linkEl.href = `/${result.slug}`;
            if (!titleEl || linkEl === titleEl) {
              linkEl.textContent = result.name;
            }
          }
          const fieldElements = item.querySelectorAll("[data-field]");
          fieldElements.forEach((el) => {
            const fieldName = el.getAttribute("data-field");
            if (fieldName && result.fieldData[fieldName] !== void 0) {
              const value = result.fieldData[fieldName];
              if (
                el instanceof HTMLAnchorElement &&
                fieldName.includes("url")
              ) {
                el.href = String(value);
              } else if (
                el instanceof HTMLImageElement &&
                fieldName.includes("image")
              ) {
                el.src = String(value);
              } else {
                el.textContent = String(value);
              }
            }
          });
          resultsContainer.appendChild(item);
        });
      }
      const debouncedSearch = debounce(
        (query) => performSearch(query),
        config.debounceMs
      );
      searchInput.addEventListener("input", (e) => {
        const target = e.target;
        debouncedSearch(target.value);
      });
      const form = searchInput.closest("form");
      if (form) {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          performSearch(searchInput.value);
        });
      }
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initSearch);
    } else {
      initSearch();
    }
  })();
})();
