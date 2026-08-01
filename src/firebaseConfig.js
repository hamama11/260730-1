import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

let db = null;
let auth = null;
let googleProvider = null;
let isFirebaseInitialized = false;

try {
    console.log("Attempting Firebase initialization with config:", firebaseConfig);
    // Check if configuration is set
    if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "your_firebase_api_key_here") {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        googleProvider = new GoogleAuthProvider();
        isFirebaseInitialized = true;
        console.log("Firebase initialized successfully via environment variables.");
    } else {
        console.error("Firebase configuration credentials not set in .env or contains placeholder key. Running in Offline/Preview mode.", firebaseConfig);
    }
} catch (e) {
    console.error("Firebase initialization failed with exception:", e);
    isFirebaseInitialized = false;
    db = null;
    auth = null;
    googleProvider = null;
}

export { db, auth, googleProvider, isFirebaseInitialized };
