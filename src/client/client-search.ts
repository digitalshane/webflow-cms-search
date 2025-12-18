// Injected at build time by esbuild
declare const DEFAULT_API_PATH: string;

export {};

(function () {
  interface SearchConfig {
    apiUrl: string;
    apiPath: string;
    collections: string;
    debounceMs: number;
  }

  interface DataItem {
    id: string;
    name: string;
    slug: string;
    collectionId: string;
    collectionSlug: string;
    fieldData: Record<string, unknown>;
    searchText: string;
  }

  interface DataResponse {
    items: DataItem[];
    total: number;
  }

  interface SearchResult {
    id: string;
    name: string;
    slug: string;
    collectionId: string;
    collectionSlug: string;
    fieldData: Record<string, unknown>;
  }

  let cachedData: DataItem[] | null = null;
  let loadingPromise: Promise<DataItem[]> | null = null;

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

  async function loadData(config: SearchConfig): Promise<DataItem[]> {
    if (cachedData) {
      return cachedData;
    }

    if (loadingPromise) {
      return loadingPromise;
    }

    loadingPromise = (async () => {
      try {
        const url = new URL(config.apiPath, config.apiUrl);
        url.searchParams.set("collections", config.collections);

        const response = await fetch(url.toString());

        if (!response.ok) {
          throw new Error(`Data fetch failed: ${response.status}`);
        }

        const data: DataResponse = await response.json();
        cachedData = data.items;
        return cachedData;
      } catch (error) {
        console.error("Webflow Search: Failed to load data:", error);
        loadingPromise = null;
        return [];
      }
    })();

    return loadingPromise;
  }

  function searchItems(items: DataItem[], query: string): SearchResult[] {
    if (!query.trim()) {
      return [];
    }

    const lowerQuery = query.toLowerCase();

    return items
      .filter((item) => item.searchText.includes(lowerQuery))
      .map((item) => ({
        id: item.id,
        name: item.name,
        slug: item.slug,
        collectionId: item.collectionId,
        collectionSlug: item.collectionSlug,
        fieldData: item.fieldData,
      }));
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
    // DEFAULT_API_PATH is replaced at build time: /api/data for dev, /app/api/data for prod
    const apiPath =
      searchInput.getAttribute("data-api-path") || DEFAULT_API_PATH;
    const collections = searchInput.getAttribute("data-collections") || "all";
    const debounceMs = parseInt(
      searchInput.getAttribute("data-debounce") || "100",
      10
    );

    // Hide the template item initially
    resultTemplate.style.display = "none";

    const config: SearchConfig = {
      apiUrl,
      apiPath,
      collections,
      debounceMs,
    };

    // Preload data immediately
    loadData(config);

    async function performSearch(query: string): Promise<void> {
      if (!query.trim()) {
        clearResults();
        return;
      }

      try {
        const items = await loadData(config);
        const results = searchItems(items, query);
        renderResults(results);
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
