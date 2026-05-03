import type { CrabtreeApi } from "../shared/types";

declare module "*.css";

declare global {
  interface Window {
    crabtree: CrabtreeApi;
  }
}
