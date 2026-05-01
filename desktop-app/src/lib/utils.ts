import { clsx, type ClassValue } from "clsx";

import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => {
  // hello world
  return twMerge(clsx(inputs));
};
