(function () {
  interface SearchConfig {
    apiUrl: string;
    collections: string;
    debounceMs: number;
  }

  interface SearchResult {
    id: string;
    name: string;
    slug: string;
    collectionId: string;
    fieldData: Record<string, unknown>;
  }

  interface SearchResponse {
    results: SearchResult[];
    total: number;
  }

  function debounce<T extends unknown[], R>(
    fn: (...args: T) => R,
    ms: number
  ): (...args: T) => void {
    let timeoutId: ReturnType<typeof setTimeout>;
    return function (this: unknown, ...args: T) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function initSearch(): void {
    const searchInput = document.querySelector<HTMLInputElement>(
      '[data-tag="search"]'
    );
    const resultsContainer = document.querySelector<HTMLElement>(
      '[data-tag="results"]'
    );
    const resultTemplate = document.querySelector<HTMLElement>(
      '[data-tag="results-item"]'
    );

    if (!searchInput) {
      console.warn("Webflow Search: No element with data-tag='search' found");
      return;
    }

    if (!resultsContainer) {
      console.warn("Webflow Search: No element with data-tag='results' found");
      return;
    }

    if (!resultTemplate) {
      console.warn(
        "Webflow Search: No element with data-tag='results-item' found"
      );
      return;
    }

    // Get configuration from data attributes
    const apiUrl =
      searchInput.getAttribute("data-api-url") || window.location.origin;
    const collections = searchInput.getAttribute("data-collections") || "all";
    const debounceMs = parseInt(
      searchInput.getAttribute("data-debounce") || "300",
      10
    );

    // Hide the template item initially
    resultTemplate.style.display = "none";

    const config: SearchConfig = {
      apiUrl,
      collections,
      debounceMs,
    };

    async function performSearch(query: string): Promise<void> {
      if (!query.trim()) {
        clearResults();
        return;
      }

      try {
        const url = new URL("/api/search", config.apiUrl);
        url.searchParams.set("q", query);
        url.searchParams.set("collections", config.collections);

        const response = await fetch(url.toString());

        if (!response.ok) {
          throw new Error(`Search failed: ${response.status}`);
        }

        const data: SearchResponse = await response.json();
        renderResults(data.results);
      } catch (error) {
        console.error("Webflow Search error:", error);
        clearResults();
      }
    }

    function clearResults(): void {
      if (!resultsContainer || !resultTemplate) return;

      // Remove all children except the template
      const children = Array.from(resultsContainer.children);
      children.forEach((child) => {
        if (child !== resultTemplate) {
          child.remove();
        }
      });
    }

    function renderResults(results: SearchResult[]): void {
      if (!resultsContainer || !resultTemplate) return;

      clearResults();

      if (results.length === 0) {
        return;
      }

      results.forEach((result) => {
        const item = resultTemplate.cloneNode(true) as HTMLElement;
        item.style.display = "";
        item.removeAttribute("data-tag");

        // Populate title
        const titleEl = item.querySelector('[data-tag="results-title"]');
        if (titleEl) {
          titleEl.textContent = result.name;
        }

        // Populate link
        const linkEl = item.querySelector<HTMLAnchorElement>(
          '[data-tag="results-link"]'
        );
        if (linkEl) {
          linkEl.href = `/${result.slug}`;
          // If link element is the same as title, also set text
          if (!titleEl || linkEl === titleEl) {
            linkEl.textContent = result.name;
          }
        }

        // Allow custom field mapping via data-field attribute
        const fieldElements = item.querySelectorAll("[data-field]");
        fieldElements.forEach((el) => {
          const fieldName = el.getAttribute("data-field");
          if (fieldName && result.fieldData[fieldName] !== undefined) {
            const value = result.fieldData[fieldName];
            if (el instanceof HTMLAnchorElement && fieldName.includes("url")) {
              el.href = String(value);
            } else if (el instanceof HTMLImageElement && fieldName.includes("image")) {
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
      (query: string) => performSearch(query),
      config.debounceMs
    );

    searchInput.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      debouncedSearch(target.value);
    });

    // Handle form submission to prevent page reload
    const form = searchInput.closest("form");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        performSearch(searchInput.value);
      });
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSearch);
  } else {
    initSearch();
  }
})();
