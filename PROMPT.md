# Prompt for Recreating "Crash Velocity" Game Clone

## 1. Project Goal

Create a 3D car driving game MVP called "Crash Velocity," inspired by the gameplay feel of the *Burnout* series. The application should be built on the Next.js framework and use the React Three Fiber ecosystem for 3D rendering and physics.

## 2. Core Technical Stack

- **Framework**: Next.js (v14.2.3) with React (v18.3.1) and TypeScript.
- **3D Rendering**: `@react-three/fiber` (v8.16.6)
- **3D Helpers**: `@react-three/drei` (v9.105.6)
- **Physics**: `@react-three/cannon` (v6.6.0) with `cannon-es` (v0.20.0).
- **Post-Processing**: `@react-three/postprocessing` (v2.16.2)
- **State Management**: `zustand` (v4.5.2)
- **UI & Debugging**: `leva` (v0.9.35) for a debug panel.
- **Styling**: Tailwind CSS with `shadcn/ui` components.
- **AI**: Google's Genkit (`@genkit-ai/googleai`) for a server-side AI flow.

## 3. Key Features & Implementation Details

### 3.1. Main Game Scene (`src/app/page.tsx`)

- The main page should be a client component (`"use client"`).
- It will host the main `Canvas` for the 3D scene.
- **Canvas Setup**:
  - The canvas should be fullscreen and handle shadows.
  - Set a default camera position: `position: [0, 5, 15], fov: 50`.
  - Implement a `fog` effect: `args={['#171720', 20, 70]}`.
- **Lighting & Environment**:
  - Use `<Sky>` from `@react-three/drei` for a dynamic skybox.
  - Use `<Environment preset="night" />` for realistic reflections.
  - Add an `ambientLight` and a `directionalLight` that casts shadows.
- **Physics World**:
  - Wrap the dynamic scene elements in a `<Physics>` provider from `@react-three/cannon`.
  - Configure gravity to `[0, -9.81, 0]`.
  - Enable the `<Debug>` component to visualize physics wireframes during development.
- **Post-Processing**:
  - Use `<EffectComposer>` to add a `<Bloom>` effect for a neon-glow aesthetic on bright surfaces.

### 3.2. Vehicle (`src/components/vehicle-scene.tsx`)

- **Vehicle Model**:
  - Load the Honda S2000 GT AP2 model from this exact URL: `https://tuomashatakka.github.io/public/resources/models/vehicles/honda_s2000_gt_ap2/scene.gltf`.
  - Ensure the model's meshes cast shadows.
  - Rotate the model 180 degrees on the Y-axis (`[0, Math.PI, 0]`) to face forward correctly.
- **Physics Implementation**:
  - Use the `useRaycastVehicle` hook for advanced vehicle physics.
  - The chassis should be a `useBox` physics body with `mass: 150`.
  - Configure four wheels using a shared `wheelInfo` configuration, specifying their connection points, suspension, and friction properties.
- **Controls & Movement**:
  - The vehicle should be controllable via keyboard input (see `useControls` hook below).
  - Apply engine force, steering, and braking based on player input in a `useFrame` loop.
  - Implement a reset function that moves the car back to the origin and resets its velocity.
- **Camera Logic**:
  - Implement a "chase camera" that follows the vehicle.
  - The camera's position should smoothly `lerp` to a target position behind and slightly above the car, creating a fluid following motion.

### 3.3. Environment (`src/components/game-hud.tsx`)

- Create a `Track` component that serves as the ground.
- It should be a static `usePlane` physics body.
- Use `<MeshReflectorMaterial>` from `@react-three/drei` to give the ground a reflective, wet-asphalt look that interacts with the `Bloom` effect.

### 3.4. Controls & State Management

- **Keyboard Controls (`src/hooks/use-mobile.tsx`)**:
  - Create a `useControls` hook to manage keyboard state.
  - It should track `forward`, `backward`, `left`, `right`, `brake`, and `reset` actions.
  - Keys to map: `W/A/S/D` or `ArrowKeys` for movement, `Space` for brake, and `R` for reset.
- **Global State (`src/hooks/use-toast.ts`)**:
  - Use `zustand` to create a global store (`useStore`).
  - The store must contain the current `speed` of the vehicle.
  - The `Vehicle` component will calculate its speed from its physics velocity and update this state on every frame.

### 3.5. User Interface (`src/components/aftertouch-control-panel.tsx`)

- Create a `GameUI` component that overlays the 3D canvas.
- **Speedometer**:
  - Display the current speed from the `zustand` store.
  - Convert the raw velocity to km/h and display it in a stylized panel.
- **Minimap**:
  - A simple placeholder minimap UI element.
- **Controls Display**:
  - A panel that lists the keyboard controls for the player.
- **Debug Panel**:
  - Integrate the `Leva` component to provide a collapsible UI for tweaking variables at runtime.

### 3.6. AI "Aftertouch" Feature (Genkit)

- Create a Genkit flow in `src/ai/flows/aftertouch-control.ts`.
- **Purpose**: This flow should decide if a player gets "aftertouch control" (limited control after a crash) based on crash parameters.
- **Input**: `vehicleSpeed`, `impactAngle`, `environmentalObjects`.
- **Output**: A boolean `allowAftertouch` and a `reason` string.
- **Prompt**: The AI prompt should instruct a "game mechanic expert" to make this decision based on the input, considering factors like fairness and game balance.
- **Server Action**: Expose this flow via a Next.js Server Action in `src/app/actions.ts`.
