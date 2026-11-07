export const $ = (selector) => document.querySelector(selector);

export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

export function button(text, onClick, className = "") {
  const element = document.createElement("button");
  element.textContent = text;
  element.className = className;
  element.addEventListener("click", onClick);
  return element;
}

export function notice(message) {
  $("#notice").textContent = message;
}

export function modal(message) {
  $("#modal-content").textContent = message;
  $("#modal").showModal();
}
