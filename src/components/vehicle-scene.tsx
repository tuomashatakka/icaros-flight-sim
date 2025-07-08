"use client";

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function VehicleScene() {
    const mountRef = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!mountRef.current) return;

        const currentMount = mountRef.current;
        let animationFrameId: number;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, currentMount.clientWidth / currentMount.clientHeight, 0.1, 1000);
        camera.position.set(5, 2, 5);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        currentMount.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.minDistance = 3;
        controls.maxDistance = 10;
        controls.target.set(0, 0.5, 0);
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.5;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
        directionalLight.position.set(5, 10, 7.5);
        scene.add(directionalLight);
        
        const hemisphereLight = new THREE.HemisphereLight(0xBE63FF, 0xFF63B4, 1);
        scene.add(hemisphereLight);

        const groundGeometry = new THREE.PlaneGeometry(20, 20);
        const groundMaterial = new THREE.ShadowMaterial({ opacity: 0.3 });
        const groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
        groundPlane.rotation.x = -Math.PI / 2;
        groundPlane.position.y = 0;
        scene.add(groundPlane);

        const loader = new GLTFLoader();
        loader.load(
            'https://tuomashatakka.github.io/public/resources/models/vehicles/honda_s2000_gt_ap2/scene.gltf',
            (gltf) => {
                const model = gltf.scene;
                
                const box = new THREE.Box3().setFromObject(model);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                
                const maxDim = Math.max(size.x, size.y, size.z);
                const scale = 3 / maxDim;
                model.scale.set(scale, scale, scale);
                
                const newBox = new THREE.Box3().setFromObject(model);
                const newCenter = newBox.getCenter(new THREE.Vector3());
                const newSize = newBox.getSize(new THREE.Vector3());

                model.position.sub(newCenter);
                model.position.y += newSize.y / 2;

                scene.add(model);
                setLoading(false);
            },
            undefined, 
            (err) => {
                console.error('An error happened during model loading:', err);
                setError('Failed to load vehicle model.');
                setLoading(false);
            }
        );

        const handleResize = () => {
            if (!currentMount) return;
            camera.aspect = currentMount.clientWidth / currentMount.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
        };
        window.addEventListener('resize', handleResize);

        const animate = () => {
            animationFrameId = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        return () => {
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animationFrameId);
            if (currentMount) {
                currentMount.removeChild(renderer.domElement);
            }
            scene.traverse(object => {
                if (object instanceof THREE.Mesh) {
                    object.geometry.dispose();
                    if (Array.isArray(object.material)) {
                        object.material.forEach(material => material.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            });
        };
    }, []);

    return (
        <div ref={mountRef} className="h-full w-full">
            {(loading || error) && (
                 <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                     <p className="text-xl font-headline text-foreground">
                         {loading ? "Loading 3D Scene..." : error}
                     </p>
                 </div>
            )}
        </div>
    );
}
