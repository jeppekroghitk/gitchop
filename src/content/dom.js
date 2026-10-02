/** An element with its class and its text, the shape almost every node in the overlay is made in. */
export function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}
