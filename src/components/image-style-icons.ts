import type { ImageStyle } from '@/lib/brand/theme'
import { Box, Camera, PenTool, Shapes, type LucideIcon } from 'lucide-react'

/** One icon per image style, shared by the Brand Theme page and the image panel. */
export const IMAGE_STYLE_ICONS: Record<ImageStyle, LucideIcon> = {
  photorealistic: Camera,
  illustration: PenTool,
  '3d_render': Box,
  minimal_graphic: Shapes
}
