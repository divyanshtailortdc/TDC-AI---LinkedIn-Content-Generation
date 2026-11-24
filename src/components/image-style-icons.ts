import type { ImageStyleChoice } from '@/lib/brand/theme'
import {
  Box,
  Camera,
  GalleryHorizontalEnd,
  PenTool,
  Shapes,
  type LucideIcon
} from 'lucide-react'

/** One icon per image style, shared by the Brand Theme page and the image panel. */
export const IMAGE_STYLE_ICONS: Record<ImageStyleChoice, LucideIcon> = {
  my_posts: GalleryHorizontalEnd,
  photorealistic: Camera,
  illustration: PenTool,
  '3d_render': Box,
  minimal_graphic: Shapes
}
