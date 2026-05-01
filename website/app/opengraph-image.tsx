import {
  createSocialImage,
  socialImageAlt,
  socialImageContentType,
  socialImageSize,
} from "./social-image";

export const alt = socialImageAlt;
export const contentType = socialImageContentType;
export const runtime = "nodejs";
export const size = socialImageSize;

export default createSocialImage;
