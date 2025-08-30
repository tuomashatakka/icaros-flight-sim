# **App Name**: Galactic Racer

## Core Features:

- **Vehicle Import**: Import and configure the spaceship model (from `public/spaceship_-_cb1/scene.gltf`) within the React Three Fiber environment.
- **Asteroid Run**: Implement a core 'Asteroid Run' mode. The goal is to navigate a dense asteroid field, causing spectacular chain reactions of destruction.
- **Scrap System**: Implement a 'Scrap System' where aggressive flying rewards the player. Allow the player to ram opponents into asteroids and space debris. Different types of takedowns (e.g., asteroid impact, debris collision) will yield different scores.
- **Debris Field**: Integrate a dynamic debris field with AI-controlled ships and moving asteroids that react realistically to collisions.
- **Environmental Destruction**: Implement the destruction of environmental elements such as asteroids, derelict space stations, and other floating debris.
- **Wreckage Cam**: Provide a 'Wreckage Cam System', that shows dramatic slow-motion explosions and replay functionality.
- **Zero-G Aftertouch**: Give the player limited control of their vehicle's wreckage after a crash for strategic positioning in a zero-gravity environment.

## Style Guidelines:

- Primary color: Electric purple (#BE63FF). Use a vibrant, attention-grabbing purple that suggests speed and energy, while avoiding a cartoony or childish feel. This creates a strong focal point and gives the game a modern, arcade-like feel.
- Background color: Soft gray (#ECE9E6). This nearly white background gives the app a clean, minimalistic feel.
- Accent color: Hot pink (#FF63B4). This vivid hue complements the primary color, lending energy and vibrance to UI elements and CTAs. The chosen combination ensures the interface remains modern and lively without being overwhelming.
- Body text font: 'Inter' sans-serif for UI elements and other short text content; Headings font: 'Space Grotesk' sans-serif, to enhance the UI with a sharp, clean feel.
- Use vector-based icons with a consistent line weight for UI elements, maintaining a clean and modern look. Icons should be minimalist, easy to understand, and align with the game's futuristic aesthetic. When the spaceship suffers crash damage, show damage using updated, more aggressive-looking versions of these icons. Subtle animations should highlight icon changes.
- Use a dynamic, full-screen layout to maximize immersion, ensuring the game adapts seamlessly to different screen sizes and resolutions. Arrange UI elements strategically around the screen edges, prioritizing crucial information (speed, position, mini-map) while minimizing obstruction of the gameplay area. Employ a split-screen or picture-in-picture approach during multiplayer modes, dynamically adjusting the size and placement of each player's viewpoint.
- Incorporate subtle, physics-based animations for UI transitions and feedback to enhance user engagement. Introduce camera shake, particle effects, and motion blur during crashes and takedowns for a visceral feel.