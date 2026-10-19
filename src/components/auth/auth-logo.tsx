import logoDark from '@/img/tdccommercelogo-dark.webp'
import logoLight from '@/img/tdccommercelogo.webp'
import Image from 'next/image'

/** The logo in both variants; CSS shows the one for the theme, as in the sidebar. */
export function AuthLogo({ className }: { className: string }) {
  return (
    <>
      <Image
        src={logoLight}
        alt="TDC Commerce"
        priority
        className={`${className} dark:hidden`}
      />
      <Image
        src={logoDark}
        alt="TDC Commerce"
        priority
        className={`${className} hidden dark:block`}
      />
    </>
  )
}
