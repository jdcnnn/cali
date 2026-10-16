import { useEffect, type RefObject } from 'react'

/** Native scrolling with restrained desktop parallax and accessible entrances. */
export function useLandingMotion(pageRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const page = pageRef.current
    if (!page) return

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const desktopPreference = window.matchMedia('(min-width: 801px)')
    const sections = Array.from(page.querySelectorAll<HTMLElement>('main > section[id]'))
    const links = Array.from(page.querySelectorAll<HTMLAnchorElement>('.entry-header nav a'))
    const reveals = Array.from(page.querySelectorAll<HTMLElement>('[data-reveal]'))
    const scenes = Array.from(page.querySelectorAll<HTMLElement>('[data-parallax-scene]')).map(scene => ({
      element: scene,
      hero: scene.dataset.parallaxScene === 'hero',
      layers: Array.from(scene.querySelectorAll<HTMLElement>('[data-parallax]')).map(element => ({
        element,
        speed: Number(element.dataset.parallax) || 0,
      })),
    }))
    let revealObserver: IntersectionObserver | undefined
    let frame = 0
    let activeSection = ''

    function configureReveals() {
      revealObserver?.disconnect()
      reveals.forEach(element => element.removeAttribute('data-reveal-state'))
      scheduleUpdate()
      if (motionPreference.matches || !('IntersectionObserver' in window)) return

      revealObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return
          entry.target.setAttribute('data-reveal-state', 'visible')
          revealObserver?.unobserve(entry.target)
        })
      }, { rootMargin: '0px 0px -40px 0px', threshold: 0.08 })

      reveals.forEach(element => {
        // Content already in view (including hash destinations) stays immediately readable.
        if (element.getBoundingClientRect().top < window.innerHeight - 40) return
        element.setAttribute('data-reveal-state', 'pending')
        revealObserver?.observe(element)
      })
    }

    function updateScroll() {
      frame = 0
      if (!page) return
      page.toggleAttribute('data-scrolled', window.scrollY > 24)

      const parallaxEnabled = desktopPreference.matches && !motionPreference.matches
      // Measure the untransformed section, so a layer's movement cannot feed back into itself.
      const positions = scenes.map(scene => ({ scene, bounds: scene.element.getBoundingClientRect() }))
      positions.forEach(({ scene, bounds }) => {
        const travel = scene.hero
          ? Math.max(0, window.scrollY)
          : window.innerHeight * 0.5 - (bounds.top + bounds.height * 0.5)
        scene.layers.forEach(({ element, speed }) => {
          if (!parallaxEnabled) {
            element.style.removeProperty('--parallax-y')
            return
          }
          const limit = scene.hero ? 180 : 18
          const offset = Math.max(-limit, Math.min(limit, travel * speed))
          element.style.setProperty('--parallax-y', `${offset.toFixed(2)}px`)
        })
      })

      let nextSection = ''
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= window.innerHeight * 0.38) nextSection = section.id
      }
      if (nextSection === activeSection) return
      activeSection = nextSection
      links.forEach(link => {
        if (link.hash === `#${activeSection}`) link.setAttribute('aria-current', 'location')
        else link.removeAttribute('aria-current')
      })
    }

    function scheduleUpdate() {
      if (!frame) frame = window.requestAnimationFrame(updateScroll)
    }

    configureReveals()
    scheduleUpdate()
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)
    motionPreference.addEventListener('change', configureReveals)
    desktopPreference.addEventListener('change', scheduleUpdate)
    const resizeObserver = new ResizeObserver(scheduleUpdate)
    resizeObserver.observe(page)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      motionPreference.removeEventListener('change', configureReveals)
      desktopPreference.removeEventListener('change', scheduleUpdate)
      resizeObserver.disconnect()
      revealObserver?.disconnect()
      reveals.forEach(element => element.removeAttribute('data-reveal-state'))
      scenes.forEach(scene => scene.layers.forEach(({ element }) => element.style.removeProperty('--parallax-y')))
      links.forEach(link => link.removeAttribute('aria-current'))
      page.removeAttribute('data-scrolled')
    }
  }, [pageRef])
}
