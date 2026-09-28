// JSX: optional chaining on import.meta.env.
export const Widget = () => <div data-id={import.meta.env?.VITE_ANALYTICS_ID} />;
