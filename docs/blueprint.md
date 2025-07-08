# **App Name**: Crash Velocity

## Core Features:

- Vehicle Import: Import and configure the Honda S2000 GT AP2 model (from `https://tuomashatakka.github.io/public/resources/models/vehicles/honda_s2000_gt_ap2/scene.gltf`) within the React Three Fiber environment.
- Crash Mode: Implement a core 'Crash Mode' heavily inspired by the Burnout series.  The goal is vehicular mayhem and chain reaction crashes.
- Takedown System: Implement a 'Takedown System' where aggressive driving rewards the player. Allow the player to ram opponents into barriers or traffic. Multiple types of takedowns (rear-end, side-swipe, corner takedown) will give different scores.
- Traffic Integration: Integrate dense traffic patterns.  The AI traffic reacts realistically to crashes.
- Environmental Destruction: Implement destruction of environmental elements such as barriers, signs, and trackside objects. Road sections may be blocked.
- Crash Cam: Provide a 'Crash Cam System', that shows dramatic slow-motion crash sequences and replay functionality.
- Aftertouch Control: The tool should decide whether the conditions are met for applying "Aftertouch Control": give limited vehicle control during crashes for strategic positioning of the vehicle's wreck.

## Style Guidelines:

- Primary color: Electric purple (#BE63FF). Use a vibrant, attention-grabbing purple that suggests speed and energy, while avoiding a cartoony or childish feel. This creates a strong focal point and gives the game a modern, arcade-like feel.
- Background color: Soft gray (#ECE9E6). This nearly white background gives the app a clean, minimalistic feel.
- Accent color: Hot pink (#FF63B4).  This vivid hue complements the primary color, lending energy and vibrance to UI elements and CTAs. The chosen combination ensures the interface remains modern and lively without being overwhelming.
- Body text font: 'Inter' sans-serif for UI elements and other short text content; Headings font: 'Space Grotesk' sans-serif, to enhance the UI with a sharp, clean feel.
- Use vector-based icons with a consistent line weight for UI elements, maintaining a clean and modern look. Icons should be minimalist, easy to understand, and align with the game's futuristic aesthetic. When the Honda suffers crash damage, show damage using updated, more aggressive-looking versions of these icons. Subtle animations should highlight icon changes.
- Use a dynamic, full-screen layout to maximize immersion, ensuring the game adapts seamlessly to different screen sizes and resolutions. Arrange UI elements strategically around the screen edges, prioritizing crucial information (speed, position, mini-map) while minimizing obstruction of the gameplay area. Employ a split-screen or picture-in-picture approach during multiplayer modes, dynamically adjusting the size and placement of each player's viewpoint.
- Incorporate subtle, physics-based animations for UI transitions and feedback to enhance user engagement. Introduce camera shake, particle effects, and motion blur during crashes and takedowns for a visceral feel.