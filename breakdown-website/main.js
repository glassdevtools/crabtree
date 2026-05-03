const root = document.getElementById("breakdown-root");
const data = window.breakdownWebsiteData;

const sections = [data.productSurface, data.website, data.desktopApp];

// -------------------------- DOM helpers ---------------

// These small DOM helpers keep the static site dependency-free while avoiding raw HTML strings.
const createElement = ({ tagName, className, text }) => {
  const element = document.createElement(tagName);

  if (className !== undefined) {
    element.className = className;
  }

  if (text !== undefined) {
    element.textContent = text;
  }

  return element;
};

// Lists and tables are the main primitives because the requested breakdown is mostly structured state.
const appendList = ({ parent, items, className }) => {
  const list = createElement({ tagName: "ul", className });

  for (const item of items) {
    const listItem = createElement({ tagName: "li", text: item });
    list.append(listItem);
  }

  parent.append(list);
};

// -------------------------- Structured renderers ---------------

// Source files are collapsible so each section starts with its state model instead of a long file list.
const appendSourceFiles = ({ parent, sourceFiles }) => {
  const details = createElement({
    tagName: "details",
    className: "sourceFiles",
  });
  const summary = createElement({
    tagName: "summary",
    text: "Source files referenced",
  });
  details.append(summary);
  appendList({ parent: details, items: sourceFiles, className: "sourceList" });
  parent.append(details);
};

// Table rows are plain objects keyed by the column configuration for each requested table.
const appendTable = ({ parent, columns, rows }) => {
  const wrapper = createElement({ tagName: "div", className: "tableWrap" });
  const table = createElement({ tagName: "table" });
  const thead = createElement({ tagName: "thead" });
  const headerRow = createElement({ tagName: "tr" });

  for (const column of columns) {
    const th = createElement({ tagName: "th", text: column.label });
    headerRow.append(th);
  }

  thead.append(headerRow);
  table.append(thead);

  const tbody = createElement({ tagName: "tbody" });

  for (const row of rows) {
    const tr = createElement({ tagName: "tr" });

    for (const column of columns) {
      const td = createElement({ tagName: "td" });
      const value = row[column.key];

      if (Array.isArray(value)) {
        appendList({ parent: td, items: value, className: "cellList" });
      } else {
        td.textContent = value;
      }

      tr.append(td);
    }

    tbody.append(tr);
  }

  table.append(tbody);
  wrapper.append(table);
  parent.append(wrapper);
};

// Type blocks keep the state unions readable without requiring TypeScript in this static site.
const appendTypeBlocks = ({ parent, variableTypes }) => {
  const grid = createElement({ tagName: "div", className: "typeGrid" });

  for (const variableType of variableTypes) {
    const article = createElement({
      tagName: "article",
      className: "typeBlock",
    });
    article.append(createElement({ tagName: "h4", text: variableType.name }));
    const pre = createElement({ tagName: "pre" });
    const code = createElement({
      tagName: "code",
      text: variableType.typeScript,
    });
    pre.append(code);
    article.append(pre);
    grid.append(article);
  }

  parent.append(grid);
};

// Feature cards always show UI state changes separately from backend responses.
const appendFeatureResponses = ({ parent, features }) => {
  const grid = createElement({ tagName: "div", className: "featureGrid" });

  for (const feature of features) {
    const article = createElement({
      tagName: "article",
      className: "featureCard",
    });
    article.append(createElement({ tagName: "h4", text: feature.feature }));

    const stateHeading = createElement({
      tagName: "h5",
      text: "State change response",
    });
    article.append(stateHeading);
    appendList({
      parent: article,
      items: feature.stateChanges,
      className: "cellList",
    });

    const backendHeading = createElement({
      tagName: "h5",
      text: "Backend responses",
    });
    article.append(backendHeading);
    appendList({
      parent: article,
      items: feature.backendResponses,
      className: "cellList",
    });

    grid.append(article);
  }

  parent.append(grid);
};

// Headings are repeated across parent, website, and desktop sections.
const appendSectionHeading = ({ parent, title, text }) => {
  const header = createElement({ tagName: "div", className: "sectionHeading" });
  header.append(createElement({ tagName: "h3", text: title }));

  if (text !== undefined) {
    header.append(createElement({ tagName: "p", text }));
  }

  parent.append(header);
};

// -------------------------- Section assembly ---------------

// Each breakdown section follows the exact six-part structure from the request.
const renderBreakdown = (section) => {
  const article = createElement({
    tagName: "article",
    className: "breakdownSection",
  });
  article.id = section.id;

  const header = createElement({
    tagName: "header",
    className: "breakdownHeader",
  });
  header.append(
    createElement({
      tagName: "p",
      className: "eyebrow",
      text: section.eyebrow,
    }),
  );
  header.append(createElement({ tagName: "h2", text: section.title }));
  header.append(
    createElement({
      tagName: "p",
      className: "summary",
      text: section.summary,
    }),
  );
  appendSourceFiles({ parent: header, sourceFiles: section.sourceFiles });
  article.append(header);

  appendSectionHeading({
    parent: article,
    title: "1. High-Level UI Variables",
    text: "Variables that affect the broad UI state for this app part.",
  });
  appendTable({
    parent: article,
    columns: [
      { key: "variable", label: "Variable" },
      { key: "source", label: "Source" },
      { key: "states", label: "States treated differently" },
      { key: "notes", label: "Notes" },
    ],
    rows: section.highLevelVariables,
  });

  appendSectionHeading({
    parent: article,
    title: "Variable State Types",
    text: "TypeScript-style unions for the states above.",
  });
  appendTypeBlocks({ parent: article, variableTypes: section.variableTypes });

  appendSectionHeading({
    parent: article,
    title: "2. UI State Flow",
    text: "Every functionally different state and modal at a practical level.",
  });
  const mermaidBlock = createElement({ tagName: "pre", className: "mermaid" });
  mermaidBlock.textContent = section.flowchart;
  article.append(mermaidBlock);

  appendSectionHeading({
    parent: article,
    title: "3. Background States",
    text: "General states behind the visible UI.",
  });
  appendTable({
    parent: article,
    columns: [
      { key: "state", label: "Background state" },
      { key: "trigger", label: "Trigger" },
      { key: "behavior", label: "Behavior" },
    ],
    rows: section.backgroundStates,
  });

  appendSectionHeading({
    parent: article,
    title: "4. Backend Products And External Setup",
    text: "Products, env vars, secrets, and machine setup that are not fully set in the repo.",
  });
  appendTable({
    parent: article,
    columns: [
      { key: "product", label: "Product" },
      { key: "usedBy", label: "Used by" },
      { key: "neededOutsideRepo", label: "Needed outside repo" },
      { key: "expectedSource", label: "Expected source" },
    ],
    rows: section.backendProducts,
  });

  appendSectionHeading({
    parent: article,
    title: "5. User Features And Responses",
    text: "Distinct things users can do, with UI state and backend effects split apart.",
  });
  appendFeatureResponses({ parent: article, features: section.features });

  appendSectionHeading({
    parent: article,
    title: "6. Notable State Decisions",
    text: "Decisions that should be carried forward when this breakdown is updated later.",
  });
  appendTable({
    parent: article,
    columns: [
      { key: "decision", label: "Decision" },
      { key: "reason", label: "Reason" },
      { key: "carryOver", label: "Carry forward" },
    ],
    rows: section.decisions,
  });

  return article;
};

for (const section of sections) {
  root.append(renderBreakdown(section));
}

// -------------------------- Mermaid rendering ---------------

// Mermaid renders the requested flow charts after the data files have built the page.
if (window.mermaid !== undefined) {
  window.mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    themeVariables: {
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      primaryColor: "#eef3f7",
      primaryTextColor: "#1d242d",
      primaryBorderColor: "#9aa7b4",
      lineColor: "#52606d",
      secondaryColor: "#f6f0df",
      tertiaryColor: "#eff5ed",
    },
  });
  window.mermaid.run({ nodes: document.querySelectorAll(".mermaid") });
}
