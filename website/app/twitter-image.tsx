import {
  createSocialImage,
  socialImageAlt,
  socialImageContentType,
  socialImageSize,
} from "./social-image";

const twitterImageVersion = "v3";

export const alt = socialImageAlt;
export const contentType = socialImageContentType;
export const runtime = "nodejs";
export const size = socialImageSize;

export const generateImageMetadata = () => [
  {
    id: twitterImageVersion,
    alt: socialImageAlt,
    contentType: socialImageContentType,
    size: socialImageSize,
  },
];

export default createSocialImage;
