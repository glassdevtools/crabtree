import type { BranchMasterApi } from "../shared/types";

declare module "*.css";

declare global {
  interface Window {
    branchmaster: BranchMasterApi;
  }
}
