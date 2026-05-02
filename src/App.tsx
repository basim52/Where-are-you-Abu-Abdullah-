/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader } from '@googlemaps/js-api-loader';
import { 
  MapPin, 
  Search, 
  Navigation, 
  Phone, 
  Globe, 
  Star, 
  Clock, 
  ChevronRight, 
  Map as MapIcon,
  Utensils,
  Coffee,
  Info,
  X,
  LayoutGrid,
  Map as MapViewIcon,
  Compass,
  Award,
  ThumbsDown,
  TrendingUp,
  Frown,
  Trophy,
  Zap,
  Sparkles,
  Radar,
  ArrowLeft,
  Camera,
  MessageSquare,
  Heart,
  LogOut,
  User as UserIcon,
  RotateCw,
  Trash2,
  Plus,
  Upload,
  Ghost,
  BrainCircuit,
  ChefHat,
  JapaneseYen,
  DollarSign,
  Beef,
  Fish,
  UtensilsCrossed,
  Send,
  Maximize2,
  Sunrise,
  Sun,
  Home,
  Moon,
  Cake,
  GlassWater,
  Bell,
  CheckCircle,
  ArrowRight,
  Leaf,
  Baby,
  HeartHandshake,
  Users,
  Palmtree,
  Timer,
  MapPinOff,
  Dices,
  Sparkle,
  Globe2,
  Share2,
  ChevronLeft,
  Shield,
  Briefcase
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Logo } from './components/Logo';
import { auth, db, signInWithGoogle, testFirestoreConnection, handleFirestoreError, OperationType } from './lib/firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  setDoc,
  deleteDoc,
  doc,
  query, 
  where, 
  onSnapshot, 
  serverTimestamp, 
  orderBy,
  getDocs,
  Timestamp
} from 'firebase/firestore';
// AI calls moved to server-side


// Types for Google Maps Places
interface PlaceDetail extends google.maps.places.PlaceResult {
  id?: string;
  distance?: number;
  internalRating?: number;
  internalReviewCount?: number;
}

interface InternalReview {
  id?: string;
  placeId: string;
  userId: string;
  userName: string;
  userPhoto: string;
  rating: number;
  comment: string;
  photoBase64?: string;
  createdAt: Timestamp;
}

interface Visit {
  id?: string;
  userId: string;
  placeId: string;
  placeName: string;
  timestamp: Timestamp;
  rated: boolean;
}

interface AppNotification {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: Date;
}

const INITIAL_PLACES: PlaceDetail[] = [
  {
    id: 'abu_abdullah_exclusive_1',
    place_id: 'abu_abdullah_exclusive_1',
    name: 'مشويات أبو عبدالله الخاصة',
    vicinity: 'سيهات - شارع الخليج',
    rating: 5,
    user_ratings_total: 1540,
    types: ['restaurant'],
    geometry: {
      location: { lat: 26.4716, lng: 50.0436 } as any
    }
  },
  {
    id: 'abu_abdullah_exclusive_2',
    place_id: 'abu_abdullah_exclusive_2',
    name: 'قهوة زمان الفاخرة',
    vicinity: 'الدمام - الشاطئ',
    rating: 4.8,
    user_ratings_total: 890,
    types: ['cafe'],
    geometry: {
      location: { lat: 26.4529, lng: 50.1251 } as any
    }
  }
];

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyDJW2ZO5atDhKGRZf3OCoLCMq2VIC0NsVA';

export default function App() {
  const [isMapsLoaded, setIsMapsLoaded] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKeyError, setApiKeyError] = useState<boolean>(false);
  const [places, setPlaces] = useState<PlaceDetail[]>([]);
  const [placesLoading, setPlacesLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<google.maps.LatLngLiteral | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<PlaceDetail | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'map' | 'coverage'>('grid');
  const [coverageText, setCoverageText] = useState<string>('مرحباً بكم في تغطياتي الخاصة! هنا أشارككم أفضل اللحظات والأماكن التي زرتها شخصياً. أبو عبدالله دائماً في خدمتكم لاختيار الأفضل.');
  
  interface CoveragePost {
    id: string;
    title: string;
    description: string;
    date: string;
    media: { type: 'image' | 'video', url: string }[];
    mediaCount?: number;
    authorId?: string;
    authorName?: string;
  }

  const [coveragePosts, setCoveragePosts] = useState<CoveragePost[]>([]);
  const [coveragePostsLoading, setCoveragePostsLoading] = useState(true);

  // Helper to chunk large base64 strings for Firestore
  const CHUNK_SIZE = 800 * 1024; // 800KB
  const uploadChunkedMedia = async (postId: string, mediaItem: { type: 'image' | 'video', url: string }, order: number) => {
    const mediaRef = collection(db, 'coveragePosts', postId, 'media');
    const isChunked = mediaItem.url.length > CHUNK_SIZE;
    
    if (!isChunked) {
      await addDoc(mediaRef, {
        type: mediaItem.type,
        order,
        data: mediaItem.url,
        isChunked: false,
        createdAt: serverTimestamp()
      });
    } else {
      const mediaDoc = await addDoc(mediaRef, {
        type: mediaItem.type,
        order,
        isChunked: true,
        totalChunks: Math.ceil(mediaItem.url.length / CHUNK_SIZE),
        createdAt: serverTimestamp()
      });

      for (let i = 0; i < mediaItem.url.length; i += CHUNK_SIZE) {
        const chunkData = mediaItem.url.substring(i, i + CHUNK_SIZE);
        const chunkIndex = Math.floor(i / CHUNK_SIZE);
        await setDoc(doc(db, 'coveragePosts', postId, 'media', mediaDoc.id, 'chunks', `chunk_${chunkIndex}`), {
          data: chunkData,
          index: chunkIndex
        });
      }
    }
  };

  const fetchFullMedia = async (postId: string, mediaDoc: any) => {
    if (!mediaDoc.isChunked) return mediaDoc.data;
    const chunksRef = collection(db, 'coveragePosts', postId, 'media', mediaDoc.id, 'chunks');
    const chunksSnap = await getDocs(query(chunksRef, orderBy('index', 'asc')));
    const fullBase64 = chunksSnap.docs.map(d => d.data().data).join('');
    return fullBase64;
  };

  const [isEditingCoverage, setIsEditingCoverage] = useState(false);
  const [showAddMediaModal, setShowAddMediaModal] = useState(false);
  const [showAddPlaceModal, setShowAddPlaceModal] = useState(false);
  const [newPlaceData, setNewPlaceData] = useState({ name: '', vicinity: '', type: 'restaurant' as 'restaurant' | 'cafe', rating: 5 });
  const [newPostData, setNewPostData] = useState({ title: '', description: '', media: [] as { type: 'image' | 'video', url: string }[] });
  const [tempCoverageText, setTempCoverageText] = useState('');
  const [filter, setFilter] = useState<'all' | 'restaurant' | 'cafe'>('all');
  const [sortFilter, setSortFilter] = useState<'none' | 'top_rated' | 'top_rest' | 'top_cafe' | 'worst_rest' | 'worst_cafe' | 'trending' | 'nearby' | 'nearby_10'>('none');
  const [searchQuery, setSearchQuery] = useState('');
  const [displayPlaces, setDisplayPlaces] = useState<PlaceDetail[]>([]);
  const [internalRatingsMap, setInternalRatingsMap] = useState<Record<string, { rating: number, count: number }>>({});
  const [user, setUser] = useState<User | null>(null);

  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [userProfile, setUserProfile] = useState<{ email: string; role: 'admin' | 'user' } | null>(null);

  // Hardcoded Admin for current environment
  const ADMIN_EMAIL = 'basim5252@gmail.com';

  useEffect(() => {
    // Check if current user is admin
    const isAdminEmail = user?.email === ADMIN_EMAIL;
    setIsAdmin(isAdminEmail);
  }, [user]);

  // Sync Places from Firestore
  const firestorePlacesRef = useRef<PlaceDetail[]>([]);
  useEffect(() => {
    // If we have no places at all, start with INITIAL_PLACES
    if (places.length === 0) {
      setPlaces(INITIAL_PLACES);
    }
    
    const unsubscribe = onSnapshot(collection(db, 'places'), (snapshot) => {
      if (!snapshot.empty) {
        const firestorePlaces = snapshot.docs.map(doc => ({
          ...doc.data(),
          id: doc.id,
          place_id: doc.id
        })) as PlaceDetail[];
        firestorePlacesRef.current = firestorePlaces;
        setPlaces(prev => {
          const merged = [...firestorePlaces];
          prev.forEach(p => {
            const pid = p.place_id || p.id;
            if (pid && !merged.find(m => (m.place_id || m.id) === pid)) {
              merged.push(p);
            }
          });
          return merged;
        });
      } else {
        // If snapshot is empty, we still have our INITIAL_PLACES in state
        // We can try to bootstrap here if we are admin
        if (isAdmin) {
          INITIAL_PLACES.forEach(async (p) => {
            try { await setDoc(doc(db, 'places', p.id || p.place_id), p); } catch (e) {}
          });
        }
      }
      setPlacesLoading(false);
    }, (error) => {
      console.warn("Places Fetch failed:", error.message);
      setPlacesLoading(false);
    });
    return () => unsubscribe();
  }, [isAdmin]);

  // Sync Ratings from Firestore
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'ratings'), (snapshot) => {
      const ratings: Record<string, { rating: number, count: number }> = {};
      snapshot.docs.forEach(doc => {
        ratings[doc.id] = doc.data() as { rating: number, count: number };
      });
      setInternalRatingsMap(ratings);
    });
    return () => unsubscribe();
  }, []);
  
  const [openNowOnly, setOpenNowOnly] = useState<boolean>(false);
  const [priceFilter, setPriceFilter] = useState<number | null>(null);
  const [searchRadius, setSearchRadius] = useState<number>(5000);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notifInput, setNotifInput] = useState('');
  const [showNotifAdmin, setShowNotifAdmin] = useState(false);
  
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark' || 
        (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });
  const [showWheel, setShowWheel] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [winnerPlace, setWinnerPlace] = useState<PlaceDetail | null>(null);
  const [timeGreeting, setTimeGreeting] = useState({ title: '', subtitle: '' });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const handleSpin = () => {
    console.log("Spinning logic executing...");
    setIsSpinning(true);
    setWinnerPlace(null);
    
    const sourceList = displayPlaces.length > 0 ? displayPlaces : (places.length > 0 ? places : []);
    
    setTimeout(() => {
      if (sourceList.length > 0) {
        const randomIndex = Math.floor(Math.random() * sourceList.length);
        setWinnerPlace(sourceList[randomIndex]);
      } else {
        const fallbacks = [
          { name: 'شاورما أبو عبدالله', vicinity: 'أقرب فرع لك' },
          { name: 'قهوة المختصين', vicinity: 'مركز المدينة' },
          { name: 'منتزه السلام', vicinity: 'حي الروضة' }
        ];
        const randomFallback = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        setWinnerPlace(randomFallback as any);
      }
      setIsSpinning(false);
    }, 1500);
  };

  const handleInviteFriend = (place: PlaceDetail) => {
    const message = `👋 هلا يا أبو عبدالله! 

ياخي ما ودك نغير جو؟ لقيت لك مكان خيالي:
📍 ${place.name}
🌟 تقييمنا له: ${place.internalRating?.toFixed(1) || '---'}

وش قلت؟ نعتمد؟
رابط المكان: ${place.url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name || '')}&query_place_id=${place.place_id}`}`;
    
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
  };

  const addNotification = (message: string, type: AppNotification['type'] = 'info') => {
    if (!isAdmin) {
      console.warn("Unauthorized: Only admins can send notifications");
      return;
    }
    const newNotif: AppNotification = {
      id: Math.random().toString(36).substring(7),
      message,
      type,
      timestamp: new Date(),
    };
    setNotifications(prev => [newNotif, ...prev]);
    // Auto remove after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== newNotif.id));
    }, 5000);
  };

  useEffect(() => {
    const now = new Date();
    const hour = now.getHours();
    const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const currentDay = dayNames[now.getDay()];
    const userName = user?.displayName?.split(' ')[0] || 'أبو عبدالله';
    const city = userLocation ? 'حولك' : 'في المنطقة';

    let greetingTitle = '';
    let greetingSubtitle = '';

    const isWeekend = now.getDay() === 4 || now.getDay() === 5; // Thursday or Friday

    if (hour >= 5 && hour < 12) {
      greetingTitle = `صباح الورد يا ${userName}`;
      greetingSubtitle = isWeekend ? `صباح ${currentDay} الونيس، وش رايك بفطور رايق يبدأ إجازتك؟` : `صباح ${currentDay}، وش رايك بفطور يضبط يومك ${city}؟`;
    } else if (hour >= 12 && hour < 17) {
      greetingTitle = `طاب غداك يا ${userName}`;
      greetingSubtitle = `غدوة ${currentDay} تبيض الوجه، وين ناوي تروح؟`;
    } else if (hour >= 17 && hour < 21) {
      greetingTitle = `مساء الخير يا ${userName}`;
      greetingSubtitle = `أجواء ${currentDay} ${city} يبيلها فنجال قهوة يضبط المزاج.`;
    } else {
      greetingTitle = `ليلتك سعيدة يا ${userName}`;
      greetingSubtitle = `ختامها مسك، وش رايك بأماكن هادئة لليلة ${currentDay}؟`;
    }

    setTimeGreeting({ title: greetingTitle, subtitle: greetingSubtitle });
  }, [user, userLocation]);

  const [internalReviews, setInternalReviews] = useState<InternalReview[]>([]);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState<'review' | 'photo' | null>(null);
  const [showSpecialRatingModal, setShowSpecialRatingModal] = useState(false);
  const [reviewToDelete, setReviewToDelete] = useState<string | null>(null);
  const [isDeletingReview, setIsDeletingReview] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState<number>(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [pendingReminder, setPendingReminder] = useState<Visit | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [reviewForm, setReviewForm] = useState({ rating: 5, comment: '', photo: '' });

  // Favorites state
  const [favorites, setFavorites] = useState<string[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  // Mood Selection States
  const [showMoodSection, setShowMoodSection] = useState(false);
  const [moodPrefs, setMoodPrefs] = useState<{
    type: string[];
    cuisine: string[];
    price: string[];
    mealType: string[];
    diningStyle: string[];
    vibe: string[];
    seating: string[];
    context: string[];
  }>({
    type: [],
    cuisine: [],
    price: [],
    mealType: [],
    diningStyle: [],
    vibe: [],
    seating: [],
    context: []
  });
  const [aiRecommendation, setAiRecommendation] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Initialize Autocomplete
  useEffect(() => {
    if (isMapsLoaded && searchInputRef.current && !autocompleteRef.current) {
        autocompleteRef.current = new google.maps.places.Autocomplete(searchInputRef.current, {
            types: ['establishment'],
            componentRestrictions: { country: 'sa' },
            fields: ['place_id', 'name', 'formatted_address', 'geometry', 'opening_hours']
        });

        autocompleteRef.current.addListener('place_changed', () => {
            const place = autocompleteRef.current?.getPlace();
            if (place?.place_id) {
                setSearchQuery(place.name || '');
                handlePlaceSelect(place.place_id);
            }
        });
    }
  }, [isMapsLoaded]);

  // Listen for Auth changes
  useEffect(() => {
    testFirestoreConnection();
    const unsubscribe = onAuthStateChanged(auth, (currUser) => {
      setUser(currUser);
    });
    return () => unsubscribe();
  }, []);

  // Listen for coverage posts
  useEffect(() => {
    const q = query(
      collection(db, 'coveragePosts'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const postsWithMediaPromises = snapshot.docs.map(async (docSnap) => {
        const data = docSnap.data();
        const createdAt = data.createdAt as Timestamp;
        const dateStr = createdAt ? new Date(createdAt.toMillis()).toLocaleDateString('ar-SA', { day: 'numeric', month: 'long' }) : 'الآن';
        
        // Fetch sub-collection media
        const mediaRef = collection(db, 'coveragePosts', docSnap.id, 'media');
        const mediaSnap = await getDocs(query(mediaRef, orderBy('order', 'asc')));
        
        const mediaItems = await Promise.all(mediaSnap.docs.map(async (mDoc) => {
          const mData = mDoc.data();
          const fullData = await fetchFullMedia(docSnap.id, { ...mData, id: mDoc.id });
          return { type: mData.type, url: fullData };
        }));

        return {
          id: docSnap.id,
          ...data,
          media: mediaItems,
          date: dateStr
        } as CoveragePost;
      });

      const results = await Promise.all(postsWithMediaPromises);
      setCoveragePosts(results);
      setCoveragePostsLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'coveragePosts');
      setCoveragePostsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Listen for app settings
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'coverage'), (snapshot) => {
      if (snapshot.exists()) {
        setCoverageText(snapshot.data().coverageIntro);
      }
    }, (error) => {
      console.warn("Settings fetch failed (likely no doc yet):", error.message);
    });
    return () => unsubscribe();
  }, []);

  // Listen for internal reviews when a place is selected
  useEffect(() => {
    if (!selectedPlace?.place_id) {
      setInternalReviews([]);
      return;
    }

    const q = query(
      collection(db, 'reviews'),
      where('placeId', '==', selectedPlace.place_id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reviews = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as InternalReview[];
      
      reviews.sort((a, b) => {
        const timeA = a.createdAt?.toMillis() || 0;
        const timeB = b.createdAt?.toMillis() || 0;
        return timeB - timeA;
      });
      
      setInternalReviews(reviews);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'reviews');
    });

    return () => unsubscribe();
  }, [selectedPlace?.place_id]);

  // Aggregated ratings logic
  useEffect(() => {
    const q = query(collection(db, 'reviews'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allReviews = snapshot.docs.map(doc => doc.data() as InternalReview);
      const newMap: Record<string, { rating: number, count: number }> = {};
      
      allReviews.forEach(review => {
        if (!newMap[review.placeId]) {
          newMap[review.placeId] = { rating: 0, count: 0 };
        }
        newMap[review.placeId].rating += review.rating;
        newMap[review.placeId].count += 1;
      });

      Object.keys(newMap).forEach(id => {
        newMap[id].rating = newMap[id].rating / newMap[id].count;
      });

      setInternalRatingsMap(newMap);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'reviews');
    });

    return () => unsubscribe();
  }, []);

  // Notification / Reminder Logic
  useEffect(() => {
    if (!user) {
      setPendingReminder(null);
      return;
    }

    const checkReminders = async () => {
      try {
        const visitsRef = collection(db, 'visits');
        const q = query(
          visitsRef, 
          where('userId', '==', user.uid), 
          where('rated', '==', false),
          orderBy('timestamp', 'desc')
        );
        
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const mostRecentDoc = querySnapshot.docs[0];
          const mostRecent = { id: mostRecentDoc.id, ...mostRecentDoc.data() } as Visit;
          
          const now = Date.now();
          const visitTime = mostRecent.timestamp.toMillis();
          const diffMin = (now - visitTime) / (1000 * 60);
          
          if (diffMin > 1 && diffMin < 4320) {
             setPendingReminder(mostRecent);
          }
        }
      } catch (err) {
        console.error("Reminder check failed:", err);
      }
    };

    checkReminders();
    const interval = setInterval(checkReminders, 60000);
    return () => clearInterval(interval);
  }, [user]);

  const recordVisit = async (place: google.maps.places.PlaceResult) => {
    if (!user || !place.place_id) return;
    try {
      const visitsRef = collection(db, 'visits');
      const q = query(
        visitsRef, 
        where('userId', '==', user.uid), 
        where('placeId', '==', place.place_id)
      );
      const existing = await getDocs(q);
      
      if (existing.empty) {
        await addDoc(visitsRef, {
          userId: user.uid,
          placeId: place.place_id,
          placeName: place.name || 'مكان مجهول',
          timestamp: serverTimestamp(),
          rated: false
        });
      }
    } catch (err) {
      console.error("Failed to record visit:", err);
    }
  };

  const skipReminder = async () => {
    if (!pendingReminder || !pendingReminder.id) return;
    try {
      await deleteDoc(doc(db, 'visits', pendingReminder.id));
      setPendingReminder(null);
    } catch (err) {
      console.error("Failed to skip reminder:", err);
    }
  };

  const openReminderRating = () => {
    if (!pendingReminder) return;
    handlePlaceSelect(pendingReminder.placeId);
    setPendingReminder(null);
  };

  // Listen for favorites
  useEffect(() => {
    if (!user) {
      setFavorites([]);
      return;
    }

    const q = query(
      collection(db, 'favorites'),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const favIds = snapshot.docs.map(doc => doc.data().placeId as string);
      setFavorites(favIds);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'favorites');
    });

    return () => unsubscribe();
  }, [user]);

  // Smart Filtering & Sorting Logic
  useEffect(() => {
    let result = places.map(p => ({
      ...p,
      internalRating: internalRatingsMap[p.place_id || '']?.rating,
      internalReviewCount: internalRatingsMap[p.place_id || '']?.count
    }));

    if (showFavoritesOnly) {
      result = result.filter(p => favorites.includes(p.place_id || ''));
    }

    if (sortFilter === 'top_rated') {
      result = result
        .sort((a, b) => ((b.internalRating || b.rating) || 0) - ((a.internalRating || a.rating) || 0));
    } else if (sortFilter === 'nearby') {
      result = result
        .sort((a, b) => (a.distance || 0) - (b.distance || 0));
    } else if (sortFilter === 'top_rest') {
      result = result
        .filter(p => p.types?.includes('restaurant'))
        .sort((a, b) => ((b.internalRating || b.rating) || 0) - ((a.internalRating || a.rating) || 0))
        .slice(0, 10);
    } else if (sortFilter === 'top_cafe') {
      result = result
        .filter(p => p.types?.includes('cafe'))
        .sort((a, b) => ((b.internalRating || b.rating) || 0) - ((a.internalRating || a.rating) || 0))
        .slice(0, 10);
    } else if (sortFilter === 'worst_rest') {
      result = result
        .filter(p => p.types?.includes('restaurant'))
        .sort((a, b) => ((a.internalRating || a.rating) || 10) - ((b.internalRating || b.rating) || 10))
        .slice(0, 10);
    } else if (sortFilter === 'worst_cafe') {
      result = result
        .filter(p => p.types?.includes('cafe'))
        .sort((a, b) => ((a.internalRating || a.rating) || 10) - ((b.internalRating || b.rating) || 10))
        .slice(0, 10);
    } else if (sortFilter === 'trending') {
      result = result
        .filter(p => (p.user_ratings_total || 0) > 100) // Trending based on review count and rating
        .sort((a, b) => (b.user_ratings_total || 0) - (a.user_ratings_total || 0))
        .slice(0, 12);
    } else if (sortFilter === 'nearby_10') {
      result = result
        .sort((a, b) => (a.distance || 0) - (b.distance || 0))
        .slice(0, 10);
    }
    
    if (filter !== 'all') {
      result = result.filter(p => p.types?.includes(filter));
    }

    // Phase 2 Filters
    if (openNowOnly) {
      result = result.filter(p => isPlaceOpen(p) === true);
    }
    
    if (priceFilter !== null) {
      result = result.filter(p => p.price_level === priceFilter);
    }

    if (searchQuery && !autocompleteRef.current?.getPlace()?.name) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p => 
        p.name?.toLowerCase().includes(q) || 
        p.types?.some(t => t.toLowerCase().includes(q)) ||
        p.vicinity?.toLowerCase().includes(q)
      );
    }

    setDisplayPlaces(result);
  }, [places, sortFilter, filter, internalRatingsMap, showFavoritesOnly, openNowOnly, priceFilter, searchQuery]);

  const handleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.error('Login error details:', err);
      if (err.code === 'auth/unauthorized-domain') {
        alert('خطأ: النطاق الحالي غير مصرح به في Firebase. يرجى إضافة هذا النطاق إلى Authorized Domains.');
      } else if (err.code === 'auth/popup-blocked') {
        alert('تم حظر النافذة المنبثقة. يرجى السماح بالمنبثقات لهذا الموقع.');
      } else {
        alert(`فشل تسجيل الدخول: ${err.message || 'خطأ غير معروف'}`);
      }
    }
  };

  const toggleFavorite = async (e: React.MouseEvent, placeId: string) => {
    e.stopPropagation();
    if (!user) {
      handleLogin();
      return;
    }

    try {
      const favoritesRef = collection(db, 'favorites');
      
      if (favorites.includes(placeId)) {
        const q = query(
          favoritesRef,
          where('userId', '==', user.uid),
          where('placeId', '==', placeId)
        );
        const snapshot = await getDocs(q);
        const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, 'favorites', d.id)));
        await Promise.all(deletePromises);
      } else {
        await addDoc(favoritesRef, {
          userId: user.uid,
          placeId: placeId,
          createdAt: serverTimestamp()
        });
      }
    } catch (err) {
      alert('حدث خطأ في تحديث المفضلة.');
      handleFirestoreError(err, OperationType.WRITE, 'favorites');
    }
  };

  const submitReview = async () => {
    if (!user) {
      handleLogin();
      return;
    }

    if (!selectedPlace?.place_id) return;

    setIsSubmittingReview(true);
    try {
      const reviewsCollection = collection(db, 'reviews');
      const reviewData: any = {
        placeId: selectedPlace.place_id!,
        userId: user.uid,
        userName: user.displayName || 'مستخدم مجهول',
        userPhoto: user.photoURL || '',
        rating: reviewForm.rating,
        createdAt: serverTimestamp()
      };

      if (reviewForm.comment.trim()) {
        reviewData.comment = reviewForm.comment.trim();
      }

      if (reviewForm.photo) {
        reviewData.photoBase64 = reviewForm.photo;
      }

      await addDoc(reviewsCollection, reviewData);

      if (user) {
        const visitsRef = collection(db, 'visits');
        const q = query(visitsRef, where('userId', '==', user.uid), where('placeId', '==', selectedPlace.place_id));
        const visitSnaps = await getDocs(q);
        visitSnaps.forEach(async (vDoc) => {
          await deleteDoc(doc(db, 'visits', vDoc.id));
        });
      }

      setSubmitSuccess(true);
      setTimeout(() => {
        setShowReviewModal(null);
        setShowSpecialRatingModal(false);
        setSubmitSuccess(false);
        setReviewForm({ rating: 5, comment: '', photo: '' });
      }, 2000);
    } catch (err) {
      alert('فشل حفظ التقييم. حاول مرة أخرى.');
      handleFirestoreError(err, OperationType.WRITE, 'reviews');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        alert('حجم الصورة كبير جداً. يرجى اختيار صورة أقل من 10 ميجابايت.');
        return;
      }

      setIsUploadingPhoto(true);
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.src = reader.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          const MAX_SIZE = 800;
          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const base64 = canvas.toDataURL('image/jpeg', 0.6);
            setReviewForm(prev => ({ ...prev, photo: base64 }));
          }
          setIsUploadingPhoto(false);
        };
        img.onerror = () => {
          setIsUploadingPhoto(false);
          alert('فشل في تحميل الصورة.');
        };
      };
      reader.onerror = () => {
        setIsUploadingPhoto(false);
        alert('فشل في قراءة الملف.');
      };
      reader.readAsDataURL(file);
    }
  };

  const googleRef = useRef<any>(null);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);

  useEffect(() => {
    const loader = new Loader({
      apiKey: GOOGLE_MAPS_API_KEY || '',
      version: 'weekly',
      libraries: ['places']
    });

    loader.load().then((google) => {
      googleRef.current = google;
      setIsMapsLoaded(true);
      setApiKeyError(false);
    }).catch(e => {
      console.error('Error loading Google Maps:', e);
      setError('فشل تحميل خرائط غوغل. تأكد من أن مفتاح API صالح ومفعل.');
      setApiKeyError(true);
    });
  }, []);

  const [isLocationPromptVisible, setIsLocationPromptVisible] = useState<boolean>(false);
  const [lastUsedQuery, setLastUsedQuery] = useState<string | null>(null);

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const isPlaceOpen = (place: any) => {
    if (place.business_status && place.business_status !== 'OPERATIONAL') return false;
    
    // Check modern isOpen function
    if (typeof place.isOpen === 'function') {
      try { return place.isOpen(); } catch (e) {}
    }
    
    const oh = place.opening_hours;
    if (oh) {
      if (typeof oh.isOpen === 'function') {
        try { return oh.isOpen(); } catch (e) {}
      }
      // Fallback to open_now boolean if it exists
      if (typeof oh.open_now === 'boolean') {
        return oh.open_now;
      }
    }
    
    // If we have opening_hours but couldn't determine status, return undefined
    return undefined;
  };

  const findNearby = useCallback((query?: string, customRadius?: number, isFallback: boolean = false) => {
    if (!isMapsLoaded || !googleRef.current) return;

    const radius = customRadius || searchRadius;
    
    if (!userLocation) {
      if (!sessionStorage.getItem('locationPromptDismissed')) {
        setIsLocationPromptVisible(true);
      }
      setLastUsedQuery(query || null);
      return;
    }

    setLoading(true);
    setPlaces([]);
    setError(null);

    if (!placesServiceRef.current) {
        const dummyMap = new googleRef.current.maps.Map(document.createElement('div'));
        placesServiceRef.current = new googleRef.current.maps.places.PlacesService(dummyMap);
    }

    const handleResults = (results: google.maps.places.PlaceResult[] | null, status: google.maps.places.PlacesServiceStatus) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && results) {
        const sortedResults = results.map(place => ({
          ...place,
          distance: place.geometry?.location ? 
            calculateDistance(userLocation.lat, userLocation.lng, place.geometry.location.lat(), place.geometry.location.lng()) : undefined
        })).sort((a, b) => (a.distance || 0) - (b.distance || 0));

        // Merge with existing Firestore places
        setPlaces(prev => {
          const merged = [...(sortedResults as PlaceDetail[])];
          prev.forEach(p => {
            const pid = p.place_id || p.id;
            if (pid && !merged.find(m => (m.place_id || m.id) === pid)) {
              merged.push(p);
            }
          });
          return merged;
        });
        setLoading(false);
      } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS || !results || results.length === 0) {
        if (!isFallback && radius < 20000) {
          // Automatic expansion (Fallback)
          findNearby(query, radius + 5000, true);
        } else {
          // DO NOT clear places here, keep Firestore places
          setError(isFallback ? 'دورت حولك حتى 15 كيلو وما لقيت خيارات تبيض الوجه، جرب تبحث عن شي ثاني؟' : 'لم يتم العثور على نتائج.');
          setLoading(false);
        }
      } else {
        setError('حدث خطأ أثناء البحث.');
        setLoading(false);
      }
    };

    const searchParams: any = {
      location: userLocation,
      radius: radius
    };

    if (query) {
      placesServiceRef.current?.textSearch({ ...searchParams, query }, handleResults);
    } else {
      placesServiceRef.current?.nearbySearch({ 
        ...searchParams, 
        type: filter === 'all' ? 'restaurant' : filter, 
        keyword: filter === 'all' ? 'restaurant cafe' : undefined 
      }, handleResults);
    }
  }, [filter, isMapsLoaded, searchRadius, userLocation]);

  const requestLocation = () => {
    setIsLocationPromptVisible(false);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const location = { lat: latitude, lng: longitude };
        setUserLocation(location);
        findNearby(lastUsedQuery || undefined);
      },
      (err) => {
        setError('عشان أجيب لك أقرب وأفضل الخيارات الزينة حولك، أحتاج أعرف موقعك الحالي. ممكن تفعل الموقع من إعدادات المتصفح؟');
        setLoading(false);
      }
    );
  };

  useEffect(() => {
    if (isMapsLoaded && !searchQuery) {
        findNearby();
    }
  }, [filter, findNearby, isMapsLoaded, searchQuery, searchRadius]);

  useEffect(() => {
    if (viewMode === 'map' && mapContainerRef.current && userLocation && isMapsLoaded) {
      const map = new googleRef.current.maps.Map(mapContainerRef.current, {
        center: userLocation,
        zoom: 14,
        styles: mapStyles,
        disableDefaultUI: true,
        zoomControl: true,
      });
      mapRef.current = map;

      new googleRef.current.maps.Marker({
        position: userLocation,
        map,
        icon: {
            path: googleRef.current.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: '#3b82f6',
            fillOpacity: 1,
            strokeWeight: 4,
            strokeColor: '#ffffff',
        },
        title: 'موقعك'
      });

      markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];
      const infoWindow = new googleRef.current.maps.InfoWindow();

      places.forEach((place, index) => {
        if (place.geometry?.location) {
          const isCafe = place.types?.includes('cafe');
          const markerColor = isCafe ? '#543310' : '#ea580c';
          
          window.setTimeout(() => {
            if (!mapRef.current) return;
            const marker = new googleRef.current.maps.Marker({
              position: place.geometry.location,
              map: mapRef.current,
              title: place.name,
              animation: googleRef.current.maps.Animation.DROP,
              icon: {
                  path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
                  fillColor: markerColor,
                  fillOpacity: 1,
                  strokeWeight: 3,
                  strokeColor: '#ffffff',
                  scale: 1.8,
                  anchor: new googleRef.current.maps.Point(12, 24),
              }
            });

            marker.addListener('click', () => {
               const contentString = `
                <div style="text-align: right; font-family: sans-serif; min-width: 150px; padding: 10px;">
                  <h3 style="margin: 0 0 5px 0; font-size: 14px; font-weight: 900;">${place.name}</h3>
                  <div style="display: flex; align-items: center; justify-content: flex-end; gap: 5px; margin-bottom: 10px;">
                     <span style="font-size: 12px; font-weight: bold; color: #f59e0b;">${place.rating || '---'}</span>
                     <span style="color: #f59e0b;">★</span>
                  </div>
                  <button id="view-details-${place.place_id}" style="width: 100%; border: none; background: #1c1917; color: white; padding: 8px; border-radius: 8px; font-size: 11px; font-weight: 900; cursor: pointer;">عرض التفاصيل</button>
                </div>
               `;
               infoWindow.setContent(contentString);
               infoWindow.open(mapRef.current, marker);

               googleRef.current.maps.event.addListenerOnce(infoWindow, 'domready', () => {
                 document.getElementById(`view-details-${place.place_id}`)?.addEventListener('click', () => {
                   place.place_id && getPlaceDetails(place.place_id);
                 });
               });
            });
            markersRef.current.push(marker);
          }, index * 50);
        }
      });
    }
  }, [viewMode, places, userLocation, isMapsLoaded]);

  const getPlaceDetails = (placeId: string) => {
    if (!placesServiceRef.current) return;
    placesServiceRef.current.getDetails({ 
      placeId,
      fields: ['place_id','name','rating','user_ratings_total','formatted_address','vicinity','geometry','opening_hours','photos','formatted_phone_number','website','url','types','business_status','reviews']
    }, (place, status) => {
      if (status === googleRef.current.maps.places.PlacesServiceStatus.OK && place) {
        const internal = internalRatingsMap[placeId];
        setSelectedPlace({...place, internalRating: internal?.rating, internalReviewCount: internal?.count});
        recordVisit(place);
      }
    });
  };

  const handlePlaceSelect = (placeId: string) => getPlaceDetails(placeId);

  useEffect(() => {
    if (selectedPlace?.place_id && internalRatingsMap[selectedPlace.place_id]) {
      const internal = internalRatingsMap[selectedPlace.place_id];
      if (selectedPlace.internalRating !== internal.rating) {
        setSelectedPlace(prev => prev ? {...prev, internalRating: internal.rating, internalReviewCount: internal.count} : null);
      }
    }
  }, [internalRatingsMap, selectedPlace?.place_id]);

  const handleDeleteReview = async () => {
    if (!reviewToDelete) return;
    setIsDeletingReview(true);
    try {
      await deleteDoc(doc(db, 'reviews', reviewToDelete));
      setReviewToDelete(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `reviews/${reviewToDelete}`);
    } finally {
      setIsDeletingReview(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
      e.preventDefault();
      if (searchQuery.trim()) findNearby(searchQuery);
  };

  const toggleMoodPref = (category: keyof typeof moodPrefs, value: string) => {
    setMoodPrefs(prev => {
      const current = prev[category] as string[];
      if (current.includes(value)) return { ...prev, [category]: current.filter(v => v !== value) };
      return { ...prev, [category]: [...current, value] };
    });
  };

  const generateMoodRecommendation = async () => {
    if (!userLocation) {
      if (!sessionStorage.getItem('locationPromptDismissed')) {
        setIsLocationPromptVisible(true);
      }
      return;
    }
    
    setIsAiLoading(true);
    setError(null);
    setAiRecommendation(null);
    setAiTargetPlaceId(null);

    try {
      // First, get real results from Google Maps based on mood
      const moodQuery = Object.values(moodPrefs).flat().join(' ');
      
      const results: google.maps.places.PlaceResult[] = await new Promise((resolve) => {
        if (!placesServiceRef.current) return resolve([]);
        placesServiceRef.current.textSearch({
          location: userLocation,
          radius: 10000,
          query: moodQuery || 'restaurant'
        }, (res) => resolve(res || []));
      });

      // Merge results with firestore places
      const topResults = results.slice(0, 8).map(p => ({
        name: p.name,
        rating: p.rating,
        reviews: p.user_ratings_total,
        vicinity: p.vicinity || p.formatted_address,
        id: p.place_id,
        distance: p.geometry?.location ? 
          calculateDistance(userLocation.lat, userLocation.lng, p.geometry.location.lat(), p.geometry.location.lng()).toFixed(1) : '?'
      }));

      // Add firestore places to top recommendations if they match mood
      const relevantFirestore = firestorePlacesRef.current.slice(0, 5).map(p => ({
        name: p.name,
        rating: p.rating,
        reviews: p.user_ratings_total,
        vicinity: p.vicinity,
        id: p.place_id,
        distance: p.geometry?.location ? 
          calculateDistance(userLocation.lat, userLocation.lng, (p.geometry.location as any).lat(), (p.geometry.location as any).lng()).toFixed(1) : '?'
      }));

      const finalContext = [...topResults, ...relevantFirestore];

      const userName = user?.displayName?.split(' ')?.[0] || 'أبو عبدالله';
      const prompt = `أنت مساعد خبير ومستشار برتبة "خوي" في المطاعم والمقاهي في المنطقة الشرقية (الدمام، سيهات، الخبر) والبحرين. 
      اسم المستخدم: ${userName}. 
      مزاج المستخدم الحالي: ${JSON.stringify(moodPrefs)}. 
      الأماكن الحقيقية المتاحة حالياً حول المستخدم (Open Now): ${JSON.stringify(finalContext)}.
      
      المطلوب منك:
      1. اختيار "المكان الفائز" من القائمة بناءً على توافق المزاج (مثلاً إذا اختار رومانسي تجنب الأماكن المزدحمة).
      2. إذا كانت القائمة فارغة، اقترح أفضل مكان تعرفه في المنطقة يناسب الاختيارات.
      3. كن "أبو عبدالله" الحقيقي: استخدم فزعات، نصائح أخوية، وتحذيرات ودودة (مثل: "الزحمة هناك الحين قوية بس تستاهل الانتظار").
      4. إذا كان الفلتر "كشتة"، ركز على مطاعم تغليفها بطل أو قريبة من البحر.
      5. لا تذكر قائمة طويلة، ركز على واحد فقط وابهر المستخدم بوصفك.
      6. أنهِ ردك بذكر ID المكان المختار في سطر منفصل تماماً بصيغة "ID: [placeId]".`;

      const aiRes = await fetch('/api/ai/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      if (!aiRes.ok) {
        const errData = await aiRes.json().catch(() => ({}));
        throw new Error(errData.details || 'فشل الاتصال بخدمة الذكاء الاصطناعي');
      }

      const aiData = await aiRes.json();
      const text = aiData.text || 'لا يوجد اقتراح حالياً.';
      const idMatch = text.match(/ID:\s*([a-zA-Z0-9_-]+)/);
      const cleanedText = text.replace(/ID:\s*[a-zA-Z0-9_-]+/, '').trim();
      
      setAiRecommendation(cleanedText);
      if (idMatch?.[1]) {
        setAiTargetPlaceId(idMatch[1]);
      }

      // Also update the main list with these focused results
      if (results.length > 0) {
        const sorted = results.map(p => ({
          ...p,
          distance: p.geometry?.location ? 
            calculateDistance(userLocation.lat, userLocation.lng, p.geometry.location.lat(), p.geometry.location.lng()) : undefined
        })).sort((a, b) => (a.distance || 0) - (b.distance || 0));
        
        setPlaces(prev => {
          const merged = [...firestorePlacesRef.current];
          sorted.forEach(s => {
            if (!merged.find(m => m.place_id === s.place_id)) merged.push(s as PlaceDetail);
          });
          return merged;
        });
      }
    } catch (err: any) {
      setError(err.message || 'فشل الحصول على نصيحة ذكية حالياً.');
    } finally { setIsAiLoading(false); }
  };

  const [aiTargetPlaceId, setAiTargetPlaceId] = useState<string | null>(null);
  
  const handleChallengeMe = () => {
    if (!userLocation) {
      if (!sessionStorage.getItem('locationPromptDismissed')) {
        setIsLocationPromptVisible(true);
      }
      return;
    }
    
    setIsAiLoading(true);
    setAiRecommendation(null);
    setAiTargetPlaceId(null);
    
    const types = ['indian', 'mexican', 'japanese', 'turkish', 'lebanese', 'thai'];
    const randomType = types[Math.floor(Math.random() * types.length)];
    
    findNearby(`أفضل مطعم ${randomType}`, 10000);
    
    setTimeout(() => {
      setAiRecommendation(`خلك جريء يا أبو عبدالله! اليوم التحدي على مطعم ${randomType === 'indian' ? 'هندي يحرّق القلب' : randomType === 'mexican' ? 'مكسيكي نكهاته خيال' : 'جديد ومميز'}. بحثت لك عن أفضل الموجود حولك، جرب تغير الروتين ولن تندم!`);
      setIsAiLoading(false);
    }, 2000);
  };

  const [showLuckPopup, setShowLuckPopup] = useState(false);
  const [luckyPlace, setLuckyPlace] = useState<PlaceDetail | null>(null);

  const handleSurpriseMe = () => {
    if (displayPlaces.length > 0) {
      const bestPlaces = displayPlaces.filter(p => (p.rating || 0) >= 4);
      const targetList = bestPlaces.length > 0 ? bestPlaces : displayPlaces;
      const randomPlace = targetList[Math.floor(Math.random() * targetList.length)];
      
      setLuckyPlace(randomPlace);
      setShowLuckPopup(true);
      
      // Auto-select details behind the scenes
      if (randomPlace.place_id) {
        // Just prepare it
      }
    } else {
      alert('لازم تبحث أول يا غالي عشان أختار لك!');
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFCFB] dark:bg-stone-950 text-stone-900 dark:text-stone-100 font-sans selection:bg-orange-100 pb-24 md:pb-0 transition-colors duration-500" dir="rtl">
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-stone-900/95 backdrop-blur-xl border-b border-stone-100 dark:border-stone-800 py-3 sm:h-20 flex items-center shadow-sm transition-colors">
        <div className="max-w-7xl mx-auto px-4 w-full flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-3">
          <div className="flex items-center justify-center sm:justify-start gap-3 shrink-0 sm:order-1 w-full sm:w-auto">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white dark:bg-stone-800 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-md rotate-3 transition-transform overflow-hidden">
              <Logo className="w-full h-full p-1" />
            </div>
            <div className="sm:block hidden">
              <h1 className="text-lg sm:text-xl font-black tracking-tight leading-none mb-0.5">وين يا أبو عبدالله؟</h1>
              <p className="text-[9px] text-stone-400 dark:text-stone-500 font-bold uppercase tracking-widest">اكتشف وجهتك التالية</p>
            </div>
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="w-10 h-10 flex items-center justify-center bg-stone-50 dark:bg-stone-800 text-stone-500 dark:text-stone-400 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-700 transition-all border border-stone-100 dark:border-stone-700"
            >
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button 
              onClick={requestLocation}
              className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all border ${userLocation ? 'bg-orange-500 text-white border-orange-400 shadow-lg shadow-orange-500/20' : 'bg-stone-50 dark:bg-stone-800 text-stone-500 dark:text-stone-400 border-stone-100 dark:border-stone-700'}`}
              title="تفعيل الموقع"
            >
              <Navigation size={18} className={!userLocation ? 'animate-pulse' : ''} />
            </button>
          </div>
          
          <form onSubmit={handleSearch} className="w-full sm:flex-1 sm:max-w-md relative group order-3 sm:order-2">
            <Search className={`absolute right-3 top-1/2 -translate-y-1/2 ${loading ? 'text-orange-500 animate-pulse' : 'text-stone-400'} group-focus-within:text-orange-500 transition-colors pointer-events-none`} size={16} />
            <input 
              ref={searchInputRef} 
              type="text" 
              placeholder="ابحث عن مطعم أو مقهى..." 
              value={searchQuery} 
              onChange={(e) => setSearchQuery(e.target.value)} 
              className="w-full h-11 sm:h-12 pr-10 pl-3 bg-stone-100/50 border border-transparent focus:border-orange-500 focus:bg-white rounded-xl sm:rounded-2xl transition-all outline-none text-sm font-medium shadow-inner placeholder:text-stone-400" 
            />
          </form>

          <div className="flex items-center gap-2 order-2 sm:order-3 self-end sm:self-center">
            {user ? (
              <div className="flex items-center gap-2 bg-stone-50 p-1 rounded-xl border border-stone-100">
                <img src={user.photoURL || ''} className="w-8 h-8 rounded-lg bg-white shadow-sm" alt="user" referrerPolicy="no-referrer" />
                <button 
                  onClick={() => signOut(auth)} 
                  className="p-2 text-stone-400 hover:text-rose-500 transition-colors flex items-center justify-center min-w-[40px] min-h-[40px]"
                >
                  <LogOut size={18} />
                </button>
              </div>
            ) : (
              <div className="relative group/login">
                <button 
                  onClick={handleLogin} 
                  className="w-11 h-11 flex items-center justify-center bg-stone-900 text-white rounded-xl hover:bg-black transition-all shadow-lg active:scale-95"
                >
                  <UserIcon size={20} />
                </button>
                <div className="absolute top-full left-0 mt-3 p-3 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl shadow-2xl opacity-0 group-hover/login:opacity-100 transition-opacity pointer-events-none w-64 z-50 text-right">
                  <p className="text-[10px] text-stone-600 dark:text-stone-400 font-bold leading-relaxed">
                    إذا واجهت مشكلة في الدخول على Vercel، تأكد من إضافة النطاق إلى القائمة المسموحة (Authorized Domains) في إعدادات Firebase Authentication.
                  </p>
                </div>
              </div>
            )}
            <button 
              onClick={() => setViewMode(viewMode === 'grid' ? 'map' : 'grid')} 
              className="w-11 h-11 flex items-center justify-center bg-white border border-stone-200 rounded-xl text-stone-600 hover:border-orange-500 hover:text-orange-500 transition-all shadow-sm sm:hidden"
            >
              {viewMode === 'grid' ? <MapViewIcon size={20} /> : <LayoutGrid size={20} />}
            </button>
            <button 
              onClick={() => setViewMode(viewMode === 'grid' ? 'map' : 'grid')} 
              className="w-12 h-12 hidden sm:flex items-center justify-center bg-white border border-stone-200 rounded-2xl text-stone-600 hover:border-orange-500 hover:text-orange-500 transition-all shadow-sm"
            >
              {viewMode === 'grid' ? <MapViewIcon size={20} /> : <LayoutGrid size={20} />}
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="bg-rose-50 border-b border-rose-100 p-4 sticky top-20 z-30">
          <div className="max-w-7xl mx-auto flex items-center gap-3 text-rose-600">
            <Info size={18} className="shrink-0" />
            <div className="text-xs font-bold">
              {error} {apiKeyError && !GOOGLE_MAPS_API_KEY && 'يرجى إضافة مفتاح Google Maps في الإعدادات.'}
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-10 sm:py-16 lg:py-20">
        <section className="mb-12 text-center relative">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button 
                onClick={() => setShowMoodSection(!showMoodSection)} 
                className={`group relative px-8 py-4 bg-white border-2 rounded-3xl transition-all flex items-center gap-4 ${showMoodSection ? 'border-orange-500 shadow-xl' : 'border-stone-100 hover:border-orange-300'}`}
              >
                  <div className="w-12 h-12 bg-orange-100 rounded-2xl flex items-center justify-center text-orange-600">
                    <motion.div
                      animate={isAiLoading ? {
                        scale: [1, 1.2, 1],
                        rotate: [0, 10, -10, 0],
                        opacity: [1, 0.5, 1]
                      } : {
                        y: [0, -4, 0]
                      }}
                      transition={{ duration: isAiLoading ? 0.5 : 2, repeat: Infinity }}
                    >
                      <Ghost size={24} />
                    </motion.div>
                  </div>
                  <div className="text-right">
                      <h3 className="text-xl font-black text-stone-900 leading-tight">اختار وفق مزاجك</h3>
                      <p className="text-stone-400 text-[10px] font-bold uppercase tracking-widest">دع الذكاء الصناعي يقرر عنك</p>
                  </div>
              </button>

              <button 
                onClick={handleSurpriseMe}
                className="group px-6 py-4 bg-white border-2 border-emerald-100 rounded-3xl hover:border-emerald-400 hover:shadow-xl transition-all flex items-center gap-3"
              >
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-500 group-hover:rotate-12 transition-transform">
                  <Dices size={20} />
                </div>
                <div className="text-right">
                  <span className="block text-sm font-black text-stone-800">اختار لي على ذوقك!</span>
                  <span className="block text-[9px] text-stone-400 font-bold uppercase">ضربة حظ مميزة</span>
                </div>
              </button>

              <button 
                onClick={handleChallengeMe}
                className="group px-6 py-4 bg-white border-2 border-rose-100 rounded-3xl hover:border-rose-400 hover:shadow-xl transition-all flex items-center gap-3"
              >
                <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center text-rose-500 group-hover:rotate-12 transition-transform">
                  <Trophy size={20} />
                </div>
                <div className="text-right">
                  <span className="block text-sm font-black text-stone-800">تحداني!</span>
                  <span className="block text-[9px] text-stone-400 font-bold uppercase">خيار غير متوقع</span>
                </div>
              </button>
            </div>

            <AnimatePresence>
                {showMoodSection && (
                    <motion.div 
                      initial={{ opacity: 0, y: -20, scale: 0.95 }} 
                      animate={{ opacity: 1, y: 0, scale: 1 }} 
                      exit={{ opacity: 0, y: -20, scale: 0.95 }} 
                      className="mt-8 bg-white rounded-[2.5rem] p-8 border border-stone-100 shadow-2xl max-w-6xl mx-auto relative overflow-hidden"
                    >
                        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                          <BrainCircuit size={120} />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8 text-right relative z-10">
                           {/* Meal Type */}
                           <div>
                              <h4 className="font-black text-xs text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2 justify-end">
                                <span>الوجبة</span>
                                <Sun size={14} />
                              </h4>
                              <div className="flex flex-wrap gap-2 justify-end">
                                {['breakfast','lunch','dinner'].map(m => (
                                  <button key={m} onClick={() => toggleMoodPref('mealType', m)} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${moodPrefs.mealType.includes(m) ? 'bg-orange-500 text-white shadow-md' : 'bg-stone-50 text-stone-500'}`}>
                                    {m === 'breakfast' ? 'فطور' : m === 'lunch' ? 'غداء' : 'عشاء'}
                                  </button>
                                ))}
                              </div>
                           </div>

                           {/* Atmosphere */}
                           <div>
                              <h4 className="font-black text-xs text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2 justify-end">
                                <span>الأجواء</span>
                                <Sparkle size={14} />
                              </h4>
                              <div className="flex flex-wrap gap-2 justify-end">
                                {['romantic','friends','family','fast'].map(m => (
                                  <button key={m} onClick={() => toggleMoodPref('vibe', m)} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${moodPrefs.vibe.includes(m) ? 'bg-orange-500 text-white shadow-md' : 'bg-stone-50 text-stone-500'}`}>
                                    {m === 'romantic' && <Heart size={12} />}
                                    {m === 'friends' && <Users size={12} />}
                                    {m === 'family' && <Baby size={12} />}
                                    {m === 'fast' && <Timer size={12} />}
                                    {m === 'romantic' ? 'رايق' : m === 'friends' ? 'شباب' : m === 'family' ? 'عائلي' : 'مستعجل'}
                                  </button>
                                ))}
                              </div>
                           </div>

                           {/* Type */}
                           <div>
                              <h4 className="font-black text-xs text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2 justify-end">
                                <span>النوع</span>
                                <Utensils size={14} />
                              </h4>
                              <div className="flex flex-wrap gap-2 justify-end">
                                {['dessert_coffee','meat','seafood','healthy','oriental'].map(m => (
                                  <button key={m} onClick={() => toggleMoodPref('type', m)} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${moodPrefs.type.includes(m) ? 'bg-orange-500 text-white shadow-md' : 'bg-stone-50 text-stone-500'}`}>
                                    {m === 'dessert_coffee' ? 'حلى وقهوة' : m === 'meat' ? 'لحم' : m === 'seafood' ? 'بحري' : m === 'healthy' ? 'أكل صحي' : 'شعبي'}
                                  </button>
                                ))}
                              </div>
                           </div>

                           {/* Seating */}
                           <div>
                              <h4 className="font-black text-xs text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2 justify-end">
                                <span>الجلسات</span>
                                <Palmtree size={14} />
                              </h4>
                              <div className="flex flex-wrap gap-2 justify-end">
                                {['outdoor','indoor'].map(m => (
                                  <button key={m} onClick={() => toggleMoodPref('seating', m)} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${moodPrefs.seating.includes(m) ? 'bg-orange-500 text-white shadow-md' : 'bg-stone-50 text-stone-500'}`}>
                                    {m === 'outdoor' ? 'خارجية' : 'مغلقة'}
                                  </button>
                                ))}
                              </div>
                           </div>

                           {/* Special Context */}
                           <div>
                              <h4 className="font-black text-xs text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2 justify-end">
                                <span>طبيعة الطلعة</span>
                                <MapPin size={14} />
                              </h4>
                              <div className="flex flex-wrap gap-2 justify-end">
                                {['kashta','family_private','drivethru','bahrain'].map(m => (
                                  <button key={m} onClick={() => toggleMoodPref('context', m)} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${moodPrefs.context.includes(m) ? 'bg-orange-500 text-white shadow-md' : 'bg-stone-50 text-stone-500'}`}>
                                    {m === 'kashta' && <Compass size={12} />}
                                    {m === 'family_private' && <Users size={12} />}
                                    {m === 'drivethru' && <Navigation size={12} />}
                                    {m === 'bahrain' && <Globe size={12} />}
                                    {m === 'kashta' ? 'كشتة' : m === 'family_private' ? 'عائلي/خصوصية' : m === 'drivethru' ? 'درايف ثرو' : 'البحرين 🇧🇭'}
                                  </button>
                                ))}
                              </div>
                           </div>
                        </div>

                        <div className="mt-10 flex flex-col items-center gap-6">
                          <button 
                            onClick={generateMoodRecommendation} 
                            disabled={isAiLoading} 
                            className={`group relative px-12 py-5 rounded-2xl font-black text-sm uppercase tracking-widest transition-all ${isAiLoading ? 'bg-stone-100 text-stone-400 cursor-not-allowed' : 'bg-stone-900 text-white hover:bg-black hover:shadow-2xl active:scale-95'}`}
                          >
                            {isAiLoading ? (
                              <div className="flex items-center gap-3">
                                <div className="w-5 h-5 border-2 border-stone-300 border-t-orange-500 rounded-full animate-spin" />
                                <span>جاري تحليل مزاجك...</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-3">
                                <Sparkles size={18} className="text-orange-400 animate-pulse" />
                                <span>اعطني رأيك يا أبو عبدالله</span>
                              </div>
                            )}
                          </button>

                          <AnimatePresence>
                            {aiRecommendation && (
                              <motion.div 
                                initial={{ opacity: 0, y: 20 }} 
                                animate={{ opacity: 1, y: 0 }} 
                                className="w-full bg-orange-50/50 rounded-3xl p-8 border border-orange-100 relative group overflow-hidden"
                              >
                                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                                  <Sparkles size={80} />
                                </div>
                                
                                <div className="absolute -top-4 right-8 bg-orange-500 text-white px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg z-10">
                                  توصية أبو عبدالله الخبيرة
                                </div>
                                <div className="flex flex-col sm:flex-row gap-6 items-start relative z-10">
                                  <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-orange-500 shadow-sm shrink-0 mx-auto sm:mx-0">
                                    <Logo className="w-full h-full p-2" />
                                  </div>
                                  <div className="text-right flex-1">
                                    <p className="text-stone-700 text-sm leading-relaxed whitespace-pre-wrap font-medium mb-6">
                                      {aiRecommendation}
                                    </p>
                                    
                                    {aiTargetPlaceId && (
                                       <div className="flex flex-wrap gap-2 justify-end">
                                          <button 
                                            onClick={() => handlePlaceSelect(aiTargetPlaceId)}
                                            className="px-6 py-2.5 bg-stone-900 text-white rounded-xl text-xs font-black shadow-lg hover:shadow-orange-500/20 hover:bg-black transition-all flex items-center gap-2"
                                          >
                                            <Info size={14} />
                                            شوف الصور والتفاصيل
                                          </button>
                                          <a 
                                            href={`https://www.google.com/maps/dir/?api=1&destination_place_id=${aiTargetPlaceId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-6 py-2.5 bg-white border border-stone-200 text-stone-900 rounded-xl text-xs font-black hover:bg-stone-50 transition-all flex items-center gap-2"
                                          >
                                            <Navigation size={14} className="text-blue-500" />
                                            ودني للمكان!
                                          </a>
                                       </div>
                                    )}
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </section>

        <AnimatePresence>
          {isLocationPromptVisible && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }} 
                onClick={() => setIsLocationPromptVisible(false)} 
                className="absolute inset-0 bg-stone-900/60 backdrop-blur-md" 
              />
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }} 
                animate={{ scale: 1, opacity: 1 }} 
                exit={{ scale: 0.9, opacity: 0 }} 
                className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl relative z-10 text-center"
              >
                  <div className="w-20 h-20 bg-blue-50 text-blue-500 rounded-3xl flex items-center justify-center mx-auto mb-6">
                    <Navigation size={40} className="animate-pulse" />
                  </div>
                  <h2 className="text-2xl font-black text-stone-900 mb-4 tracking-tight">وينك فيه يا غالي؟</h2>
                  <p className="text-stone-500 text-sm leading-relaxed mb-8">عشان أجيب لك أقرب وأفضل الخيارات الزينة حولك، أحتاج أعرف موقعك الحالي. تبي نفعل الموقع؟</p>
                  <div className="flex flex-col gap-2">
                    <button 
                      onClick={requestLocation}
                      className="w-full py-4 bg-stone-900 text-white rounded-2xl font-black shadow-xl hover:bg-black transition-all active:scale-95"
                    >
                      إيه، فعّل الموقع
                    </button>
                    <button 
                      onClick={() => {
                        setIsLocationPromptVisible(false);
                        sessionStorage.setItem('locationPromptDismissed', 'true');
                      }}
                      className="w-full py-3 text-stone-400 text-xs font-bold"
                    >
                      مو الحين
                    </button>
                  </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <section className="mb-12 text-center text-touch">
            <motion.div
              animate={{
                y: [0, -10, 0],
              }}
              transition={{
                duration: 4,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            >
              <Logo className="w-48 h-48 mx-auto mb-8 drop-shadow-2xl" />
            </motion.div>
            <h2 className="text-4xl sm:text-6xl font-black text-stone-900 tracking-tighter mb-4">{timeGreeting.title}</h2>
            <p className="text-stone-400 text-sm sm:text-lg max-w-lg mx-auto font-medium">{timeGreeting.subtitle}</p>
        </section>

        <div className="flex flex-col gap-6 mb-8">
          {/* Manual Search Bar */}
          <div className="relative group">
            <div className="absolute inset-y-0 right-0 pr-6 flex items-center pointer-events-none text-stone-400 group-focus-within:text-orange-500 transition-colors">
              <Search size={22} />
            </div>
            <input
              type="text"
              placeholder="تبحث عن مطعم معين؟ كافيه هادئ؟ بخاري؟"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-stone-900 border-2 border-stone-100 dark:border-stone-800 rounded-[2rem] py-5 pr-16 pl-8 text-lg font-bold text-stone-900 dark:text-white placeholder:text-stone-300 dark:placeholder:text-stone-600 focus:outline-none focus:border-orange-500/30 focus:ring-4 focus:ring-orange-500/5 shadow-xl shadow-stone-200/40 dark:shadow-none transition-all text-right"
              dir="rtl"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 left-4 flex items-center text-stone-300 hover:text-stone-500"
              >
                <X size={20} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 overflow-x-auto no-scrollbar pb-2 px-1 scroll-smooth touch-pan-x">
              <button 
                onClick={() => setViewMode('coverage')} 
                className={`flex items-center gap-2 px-6 py-3.5 rounded-full whitespace-nowrap font-bold text-sm transition-all min-h-[48px] ${viewMode === 'coverage' ? 'bg-indigo-600 text-white shadow-lg ring-4 ring-indigo-500/10' : 'bg-white dark:bg-stone-900 text-stone-400 dark:text-stone-500 border border-stone-100 dark:border-stone-800 hover:border-indigo-500/30'}`}
              >
                <Briefcase size={14} />
                تغطيات أبو عبدالله 📸
              </button>

              <button 
                onClick={() => { setViewMode('grid'); setFilter('all'); setShowFavoritesOnly(false); setSortFilter('none'); setOpenNowOnly(false); setPriceFilter(null); }} 
                className={`flex items-center gap-2 px-6 py-3.5 rounded-full whitespace-nowrap font-bold text-sm transition-all min-h-[48px] ${viewMode === 'grid' && filter === 'all' && sortFilter === 'none' && !showFavoritesOnly && !openNowOnly && priceFilter === null ? 'bg-orange-500 text-white shadow-lg' : 'bg-white dark:bg-stone-900 text-stone-400 dark:text-stone-500 border border-stone-100 dark:border-stone-800 hover:border-orange-500/30'}`}
              >
                الكل
              </button>
              <button 
                onClick={() => { setViewMode('grid'); setFilter('restaurant'); setSortFilter('none'); }} 
                className={`flex items-center gap-2 px-6 py-3.5 rounded-full whitespace-nowrap font-bold text-sm transition-all min-h-[48px] ${viewMode === 'grid' && filter === 'restaurant' && sortFilter === 'none' ? 'bg-orange-500 text-white shadow-lg' : 'bg-white dark:bg-stone-900 text-stone-400 dark:text-stone-500 border border-stone-100 dark:border-stone-800 hover:border-orange-500/30'}`}
              >
                مطاعم
              </button>
              <button 
                onClick={() => { setViewMode('grid'); setFilter('cafe'); setSortFilter('none'); }} 
                className={`flex items-center gap-2 px-6 py-3.5 rounded-full whitespace-nowrap font-bold text-sm transition-all min-h-[48px] ${viewMode === 'grid' && filter === 'cafe' && sortFilter === 'none' ? 'bg-orange-500 text-white shadow-lg' : 'bg-white dark:bg-stone-900 text-stone-400 dark:text-stone-500 border border-stone-100 dark:border-stone-800 hover:border-orange-500/30'}`}
              >
                مقاهي
              </button>
              
              <div className="h-8 w-px bg-stone-100 dark:bg-stone-800 mx-2 flex-shrink-0" />

              <button 
                onClick={() => setOpenNowOnly(!openNowOnly)} 
                className={`flex items-center gap-2 px-6 py-3.5 rounded-full whitespace-nowrap font-bold text-sm transition-all min-h-[48px] ${openNowOnly ? 'bg-emerald-500 text-white shadow-lg' : 'bg-white dark:bg-stone-900 text-stone-400 dark:text-stone-500 border border-stone-100 dark:border-stone-800 hover:border-emerald-200'}`}
              >
                <Clock size={14} />
                المفتوح الآن
              </button>

              <button 
                onClick={() => { setSortFilter(sortFilter === 'top_rated' ? 'none' : 'top_rated'); }} 
                className={`flex items-center gap-2 px-6 py-3.5 rounded-full whitespace-nowrap font-bold text-sm transition-all min-h-[48px] ${sortFilter === 'top_rated' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/50 shadow-sm' : 'bg-white dark:bg-stone-900 text-stone-400 dark:text-stone-500 border border-stone-100 dark:border-stone-800 hover:bg-amber-50'}`}
              >
                <Award size={14} />
                الأعلى تقييماً
              </button>

              <button 
                onClick={() => { setSortFilter(sortFilter === 'nearby' ? 'none' : 'nearby'); }} 
                className={`flex items-center gap-2 px-6 py-3.5 rounded-full whitespace-nowrap font-bold text-sm transition-all min-h-[48px] ${sortFilter === 'nearby' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/50 shadow-sm' : 'bg-white dark:bg-stone-900 text-stone-400 dark:text-stone-500 border border-stone-100 dark:border-stone-800 hover:bg-blue-50'}`}
              >
                <Navigation size={14} />
                الأقرب منك
              </button>

              <div className="h-8 w-px bg-stone-100 dark:bg-stone-800 mx-2 flex-shrink-0" />

              <div className="flex items-center p-1 bg-white dark:bg-stone-900 border border-stone-100 dark:border-stone-800 rounded-full shadow-sm">
                {[
                  { level: 1, label: 'رخيص' },
                  { level: 2, label: 'متوسط' },
                  { level: 3, label: 'مرتفع' },
                  { level: 4, label: 'فاخر' }
                ].map((p) => (
                  <button 
                    key={p.level}
                    onClick={() => setPriceFilter(priceFilter === p.level ? null : p.level)}
                    className={`px-4 h-10 rounded-full flex items-center justify-center transition-all gap-1.5 ${priceFilter === p.level ? 'bg-stone-900 dark:bg-orange-500 text-white shadow-lg scale-105 active:scale-95' : 'text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800'}`}
                  >
                    <span className="text-[10px] font-black whitespace-nowrap">
                      {p.label}
                    </span>
                  </button>
                ))}
              </div>

              <div className="h-8 w-px bg-stone-100 dark:bg-stone-800 mx-2 flex-shrink-0" />

              <div className="flex items-center p-1 bg-white dark:bg-stone-900 border border-stone-100 dark:border-stone-800 rounded-full shadow-sm">
                <div className="pl-3 pr-1 text-stone-300 dark:text-stone-700">
                  <Radar size={16} />
                </div>
                {[
                  { val: 5000, label: '5كيلو' },
                  { val: 10000, label: '10كيلو' },
                  { val: 30000, label: '30كيلو' }
                ].map((d) => (
                  <button 
                    key={d.val}
                    onClick={() => setSearchRadius(d.val)}
                    className={`px-4 h-10 rounded-full flex items-center justify-center transition-all gap-1.5 ${searchRadius === d.val ? 'bg-stone-900 dark:bg-orange-500 text-white shadow-lg scale-105 active:scale-95' : 'text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800'}`}
                  >
                    <span className="text-[10px] font-black whitespace-nowrap">
                      {d.label}
                    </span>
                  </button>
                ))}
              </div>

              <div className="h-8 w-px bg-stone-100 dark:bg-stone-800 mx-2 flex-shrink-0" />
              
              <button 
                onClick={() => setShowFavoritesOnly(!showFavoritesOnly)} 
                className={`flex items-center gap-2 px-6 py-3.5 rounded-full whitespace-nowrap font-bold text-sm transition-all min-h-[48px] ${showFavoritesOnly ? 'bg-rose-500 text-white shadow-lg' : 'bg-white dark:bg-stone-900 text-stone-400 dark:text-stone-500 border border-stone-100 dark:border-stone-800 hover:bg-rose-50'}`}
              >
                <Heart size={14} fill={showFavoritesOnly ? "white" : "none"} />
                مفضلاتي
              </button>
          </div>
        </div>

        {viewMode === 'coverage' ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full min-h-[600px] flex flex-col gap-8"
            dir="rtl"
          >
            {/* Admin Header with Actions */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 bg-white dark:bg-stone-900 p-8 rounded-[3rem] border border-stone-100 dark:border-stone-800 shadow-xl">
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/40 rounded-3xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 shadow-inner">
                  <Camera size={32} />
                </div>
                <div>
                  <h2 className="text-4xl font-black text-stone-900 dark:text-white tracking-tight">ركن التغطيات</h2>
                  <p className="text-stone-400 text-xs font-bold mt-1">تغطيات حصرية وتقارير يومية من أبو عبدالله</p>
                </div>
              </div>

              {isAdmin && (
                <div className="flex gap-3">
                  <button 
                    onClick={() => setShowAddMediaModal(true)}
                    className="flex items-center gap-2 px-8 py-4 bg-indigo-600 text-white rounded-2xl text-xs font-black hover:bg-indigo-700 transition-all active:scale-95 shadow-xl shadow-indigo-500/20"
                  >
                    <Plus size={16} />
                    إضافة تغطية (منشور جديد)
                  </button>
                  <button 
                    onClick={() => {
                      setCoveragePosts([]);
                      addNotification('تم تصفير جميع التغطيات بنجاح', 'warning');
                    }}
                    className="flex items-center gap-2 px-6 py-4 bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 rounded-2xl text-xs font-black hover:bg-rose-100 transition-all active:scale-95 border border-rose-100 dark:border-rose-900/30"
                  >
                    <Trash2 size={16} />
                    حذف الكل
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-col md:flex-row gap-8">
              {/* Main Blog Feed */}
              <div className="flex-1 space-y-8">
                {coveragePostsLoading ? (
                  <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-stone-900 rounded-[3rem] border border-stone-100 dark:border-stone-800">
                    <RotateCw size={32} className="text-indigo-500 animate-spin mb-4" />
                    <p className="text-stone-400 font-bold">جاري تحميل التغطيات الحصرية...</p>
                  </div>
                ) : coveragePosts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-stone-900 rounded-[3rem] border-2 border-dashed border-stone-100 dark:border-stone-800">
                    <Ghost size={48} className="text-stone-200 mb-4" />
                    <p className="text-stone-400 font-bold">لا يوجد تغطيات حالياً يا أبو عبدالله</p>
                  </div>
                ) : (
                  coveragePosts.map((post) => (
                    <motion.article 
                      key={post.id}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      className="group bg-white dark:bg-stone-900 rounded-[3rem] border border-stone-100 dark:border-stone-800 overflow-hidden shadow-sm hover:shadow-2xl transition-all"
                    >
                      {/* Media Grid / Gallery */}
                      <div className={`grid gap-1 bg-stone-100 dark:bg-stone-950 ${post.media.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        {post.media.map((m, idx) => (
                          <div key={idx} className={`relative aspect-square md:aspect-video overflow-hidden ${post.media.length === 3 && idx === 0 ? 'col-span-2' : ''}`}>
                            {m.type === 'image' ? (
                              <img src={m.url} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105" alt="" />
                            ) : (
                              <video 
                                src={m.url} 
                                className="w-full h-full object-cover" 
                                controls 
                                playsInline 
                                preload="metadata"
                                poster="/video-poster.svg"
                              />
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Content Area */}
                      <div className="p-8 md:p-12 relative">
                        <div className="flex items-center justify-between mb-4">
                          <span className="text-[10px] font-black text-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1 rounded-full uppercase tracking-tighter">
                            {post.date}
                          </span>
                          {isAdmin && (
                            <button 
                              onClick={async () => {
                                try {
                                  await deleteDoc(doc(db, 'coveragePosts', post.id));
                                  addNotification('تم حذف المنشور بنجاح', 'info');
                                } catch (err) {
                                  handleFirestoreError(err, OperationType.DELETE, `coveragePosts/${post.id}`);
                                }
                              }}
                              className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-xl transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                        
                        <h3 className="text-2xl font-black text-stone-900 dark:text-white mb-4 leading-tight">{post.title}</h3>
                        <p className="text-stone-600 dark:text-stone-400 text-sm leading-relaxed whitespace-pre-wrap font-medium line-clamp-4 group-hover:line-clamp-none transition-all duration-500">
                          {post.description}
                        </p>
                      </div>
                    </motion.article>
                  ))
                )}
              </div>

              {/* Sidebar Info */}
              <div className="w-full md:w-96 space-y-8">
                <div className="bg-orange-50/50 dark:bg-orange-950/20 p-8 rounded-[3rem] border border-orange-100 dark:border-orange-900/30 relative">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-white dark:bg-stone-800 rounded-xl flex items-center justify-center text-orange-500 shadow-sm border border-orange-100 dark:border-stone-700">
                      <MessageSquare size={20} />
                    </div>
                    <h3 className="text-sm font-black text-orange-600 dark:text-orange-400 uppercase tracking-widest">حديث أبو عبدالله</h3>
                  </div>
                  
                  {isEditingCoverage ? (
                    <div className="space-y-4">
                      <textarea
                        value={tempCoverageText}
                        onChange={(e) => setTempCoverageText(e.target.value)}
                        className="w-full h-48 bg-white dark:bg-stone-800 rounded-2xl p-4 text-xs font-medium border-2 border-orange-200 dark:border-stone-700 outline-none focus:ring-4 focus:ring-orange-500/10 transition-all text-stone-900 dark:text-stone-100"
                        placeholder="اكتب حديثك يا أبو عبدالله..."
                      />
                      <div className="flex gap-2">
                        <button 
                          onClick={async () => {
                            try {
                              await setDoc(doc(db, 'settings', 'coverage'), { coverageIntro: tempCoverageText }, { merge: true });
                              setIsEditingCoverage(false);
                              addNotification('تم تحديث حديث أبو عبدالله بنجاح', 'success');
                            } catch (err) {
                              handleFirestoreError(err, OperationType.WRITE, 'settings/coverage');
                            }
                          }}
                          className="flex-1 py-3 bg-orange-500 text-white rounded-xl text-[10px] font-black shadow-lg hover:shadow-orange-500/20 active:scale-95 transition-all"
                        >
                          حفظ التعديلات
                        </button>
                        <button 
                          onClick={() => setIsEditingCoverage(false)}
                          className="px-4 py-3 bg-stone-100 dark:bg-stone-800 text-stone-400 rounded-xl text-[10px] font-bold"
                        >
                          إلغاء
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="relative">
                      <p className="text-stone-700 dark:text-stone-300 text-sm leading-relaxed font-medium mb-6">
                        {coverageText}
                      </p>
                      {isAdmin && (
                        <button 
                          onClick={() => {
                            setTempCoverageText(coverageText);
                            setIsEditingCoverage(true);
                          }}
                          className="w-full py-3 bg-white dark:bg-stone-800 border border-orange-200 dark:border-stone-700 text-orange-500 rounded-xl text-[10px] font-black hover:bg-orange-50 dark:hover:bg-orange-900/30 transition-colors flex items-center justify-center gap-2"
                        >
                          <Zap size={12} />
                          تحرير الحديث
                        </button>
                      )}
                    </div>
                  )}
                  
                  <div className="absolute -top-3 -left-3 bg-white dark:bg-stone-900 p-2 rounded-xl shadow-lg transform rotate-12 border border-stone-100 dark:border-stone-800">
                    <Sparkles size={16} className="text-orange-500" />
                  </div>
                </div>

                <div className="bg-white dark:bg-stone-900 p-8 rounded-[3rem] border border-stone-100 dark:border-stone-800">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/40 rounded-xl flex items-center justify-center text-indigo-600 shadow-sm">
                      <Trophy size={20} />
                    </div>
                    <h3 className="text-sm font-black text-stone-900 dark:text-stone-100 uppercase tracking-widest">إحصائيات المدونة</h3>
                  </div>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center p-4 bg-stone-50 dark:bg-stone-800/50 rounded-2xl">
                      <span className="text-[10px] font-bold text-stone-400">إجمالي التقارير</span>
                      <span className="text-xl font-black text-stone-900 dark:text-white">{coveragePosts.length}</span>
                    </div>
                    <div className="flex justify-between items-center p-4 bg-stone-50 dark:bg-stone-800/50 rounded-2xl">
                      <span className="text-[10px] font-bold text-stone-400">ملفات مرفوعة</span>
                      <span className="text-xl font-black text-stone-900 dark:text-white">
                        {coveragePosts.reduce((acc, curr) => acc + curr.media.length, 0)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ) : viewMode === 'map' ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} 
            animate={{ opacity: 1, scale: 1 }} 
            className="w-full h-[600px] bg-stone-100 rounded-[3rem] overflow-hidden shadow-2xl border-4 border-white relative"
          >
            <div ref={mapContainerRef} className="w-full h-full" />
            {!userLocation && (
              <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm flex items-center justify-center p-6 text-center">
                 <div className="bg-white p-8 rounded-[2.5rem] shadow-xl max-w-xs">
                    <MapPinOff size={40} className="text-stone-300 mx-auto mb-4" />
                    <p className="text-sm font-black text-stone-900 mb-4">نحتاج موقعك عشان نظهر الخريطة يا غالي</p>
                    <button onClick={requestLocation} className="px-6 py-3 bg-stone-900 text-white rounded-xl font-bold text-xs">تفعيل الموقع</button>
                 </div>
              </div>
            )}
          </motion.div>
        ) : (
          <section className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-8">
              {isAdmin && (
                <button 
                  onClick={() => setShowAddPlaceModal(true)}
                  className="group relative flex flex-col items-center justify-center bg-white dark:bg-stone-900 rounded-[2.2rem] p-6 border-2 border-dashed border-indigo-100 dark:border-indigo-900/30 hover:border-indigo-400 hover:bg-indigo-50/50 transition-all aspect-[16/11]"
                >
                  <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/50 rounded-3xl flex items-center justify-center text-indigo-600 mb-4 group-hover:scale-110 transition-transform">
                    <Plus size={32} />
                  </div>
                  <span className="text-sm font-black text-indigo-600">إضافة مكان جديد بالسحابة</span>
                </button>
              )}
              
              {loading || placesLoading ? (
                  Array.from({ length: 6 }).map((_, i) => <div key={i} className="aspect-[16/11] bg-stone-100 dark:bg-stone-800 rounded-[2.2rem] animate-pulse" />)
              ) : displayPlaces.length > 0 ? (
                  displayPlaces.map((place) => (
                      <motion.div 
                          key={place.place_id} 
                          whileHover={{ y: -8, scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => place.place_id && getPlaceDetails(place.place_id)} 
                          className="bg-white dark:bg-stone-900 rounded-[2.2rem] p-4 border border-stone-100 dark:border-stone-800 hover:shadow-2xl transition-all duration-300 cursor-pointer flex flex-col group overflow-hidden"
                      >
                          <div className="relative aspect-[16/11] rounded-[1.8rem] mb-4 overflow-hidden bg-stone-50 dark:bg-stone-800">
                              {place.photos?.[0] ? <img src={place.photos[0].getUrl({ maxWidth: 600 })} alt={place.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" /> : <div className="w-full h-full flex items-center justify-center text-stone-200 dark:text-stone-700"><Utensils size={40} /></div>}
                              <div className="absolute top-3 left-3 bg-white/95 dark:bg-stone-800/95 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm text-xs font-black text-stone-900 dark:text-white"><Star size={12} className="text-amber-500 fill-amber-500" />{place.rating || '---'}</div>
                              <button onClick={(e) => toggleFavorite(e, place.place_id || '')} className={`absolute top-3 right-3 w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md transition-all ${favorites.includes(place.place_id || '') ? 'bg-rose-500 text-white scale-110' : 'bg-white/80 dark:bg-stone-700/80 text-stone-400 dark:text-stone-500 hover:bg-white dark:hover:bg-stone-600 hover:text-rose-500'}`}><Heart size={18} fill={favorites.includes(place.place_id || '') ? 'currentColor' : 'none'} /></button>
                              {place.distance !== undefined && (
                                <div className="absolute bottom-3 right-3 bg-stone-900/80 backdrop-blur-md text-white px-3 py-1.5 rounded-xl text-[10px] font-black">يبعد {place.distance.toFixed(1)} كم</div>
                              )}
                          </div>
                          <h3 className="text-xl font-black text-stone-900 dark:text-white group-hover:text-orange-500 transition-colors mb-1 truncate">{place.name}</h3>
                          <p className="text-[11px] text-stone-400 dark:text-stone-500 font-bold truncate mb-4">{place.vicinity}</p>
                          <div className="mt-auto pt-4 border-t border-stone-50 dark:border-stone-800 flex items-center justify-between text-[11px] font-black">
                              <span className={isPlaceOpen(place) === true ? 'text-emerald-500 flex items-center gap-1' : isPlaceOpen(place) === false ? 'text-rose-400 flex items-center gap-1' : 'text-stone-400 flex items-center gap-1'}>
                                <div className={`w-2 h-2 rounded-full ${isPlaceOpen(place) === true ? 'bg-emerald-500 animate-pulse' : isPlaceOpen(place) === false ? 'bg-rose-400' : 'bg-stone-300'}`} />
                                {isPlaceOpen(place) === true ? 'مفتوح الحين' : isPlaceOpen(place) === false ? 'مغلق حالياً' : 'غير متوفر'}
                              </span>
                              <div className="bg-stone-50 dark:bg-stone-800 group-hover:bg-orange-500 p-2 rounded-xl text-stone-400 dark:text-stone-600 group-hover:text-white transition-all"> <ChevronRight size={16} className="rotate-180" /> </div>
                          </div>
                      </motion.div>
                  ))
              ) : (
                <div className="col-span-full py-20 text-center">
                   <div className="w-24 h-24 bg-stone-50 rounded-[2.5rem] flex items-center justify-center mx-auto mb-6 text-stone-200">
                     <Search size={40} />
                   </div>
                   <h3 className="text-xl font-black text-stone-900 mb-2">ما لقيت شي حولك يا غالي</h3>
                   <p className="text-stone-400 text-sm max-w-xs mx-auto">جرب تغير الفلتر أو تبحث عن مكان ثاني، أو يمكن تحتاج تفعل الموقع؟</p>
                   {!userLocation && (
                     <button onClick={requestLocation} className="mt-6 px-8 py-3 bg-stone-900 text-white rounded-2xl font-black text-xs shadow-lg">تفعيل الموقع</button>
                   )}
                </div>
              )}
          </section>
        )}
      </main>

      <AnimatePresence>
        {showLuckPopup && luckyPlace && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowLuckPopup(false)} className="absolute inset-0 bg-stone-900/80 backdrop-blur-md" />
             <motion.div 
               initial={{ scale: 0.5, opacity: 0, rotate: -10 }} 
               animate={{ scale: 1, opacity: 1, rotate: 0 }} 
               exit={{ scale: 0.5, opacity: 0, rotate: 10 }}
               className="bg-white dark:bg-stone-900 w-full max-w-sm rounded-[3rem] p-10 shadow-2xl relative z-10 text-center overflow-hidden border border-stone-100 dark:border-stone-800"
             >
                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-400 to-teal-500" />
                <div className="w-24 h-24 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner">
                  <Trophy size={48} className="animate-bounce" />
                </div>
                <h2 className="text-sm font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-[0.3em] mb-4">اختيار الحظ الفائز!</h2>
                <h3 className="text-3xl font-black text-stone-900 dark:text-white mb-2 leading-tight">{luckyPlace.name}</h3>
                <div className="flex items-center justify-center gap-2 mb-8">
                  <div className="flex items-center gap-1 text-amber-500 bg-amber-50 dark:bg-amber-900/20 px-3 py-1 rounded-full text-sm font-black">
                    <Star size={14} className="fill-amber-500" />
                    {luckyPlace.rating}
                  </div>
                  {luckyPlace.distance !== undefined && (
                    <div className="text-stone-400 dark:text-stone-500 text-xs font-bold">على بعد {luckyPlace.distance.toFixed(1)} كم</div>
                  )}
                </div>
                
                <div className="space-y-3">
                  <button 
                    onClick={() => {
                      luckyPlace.place_id && handlePlaceSelect(luckyPlace.place_id);
                      setShowLuckPopup(false);
                    }}
                    className="w-full py-4 bg-stone-900 text-white rounded-2xl font-black shadow-xl hover:bg-black transition-all active:scale-95"
                  >
                    تفاصيل المكان
                  </button>
                  <button 
                    onClick={() => setShowLuckPopup(false)}
                    className="w-full py-3 text-stone-400 text-xs font-bold"
                  >
                    جرب حظك مرة ثانية
                  </button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {selectedPlace && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedPlace(null)} className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="relative w-full max-w-4xl max-h-[90vh] bg-[#FDFCFB] dark:bg-stone-900 rounded-t-[2.5rem] sm:rounded-[3rem] shadow-2xl flex flex-col sm:flex-row overflow-hidden">
                <div className="w-full sm:w-1/2 aspect-square sm:aspect-auto sm:h-full bg-stone-100 dark:bg-stone-800 relative group">
                    {selectedPlace.photos?.[activePhotoIndex] && (
                      <motion.img 
                        key={activePhotoIndex}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        src={selectedPlace.photos[activePhotoIndex].getUrl({ maxWidth: 800 })} 
                        className="w-full h-full object-cover" 
                        alt="place" 
                      />
                    )}
                    
                    {selectedPlace.photos && selectedPlace.photos.length > 1 && (
                      <div className="absolute inset-x-0 bottom-6 flex justify-center gap-2 px-6">
                        <div className="flex gap-2 bg-black/20 backdrop-blur-md p-1.5 rounded-full">
                          {selectedPlace.photos.slice(0, 5).map((_, i) => (
                            <button 
                              key={i}
                              onClick={(e) => { e.stopPropagation(); setActivePhotoIndex(i); }}
                              className={`w-2 h-2 rounded-full transition-all ${i === activePhotoIndex ? 'bg-white w-4' : 'bg-white/40'}`}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedPlace.photos && selectedPlace.photos.length > 1 && (
                      <>
                        <button 
                          onClick={(e) => { e.stopPropagation(); setActivePhotoIndex(prev => prev > 0 ? prev - 1 : selectedPlace.photos!.length - 1); }}
                          className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/80 rounded-full flex items-center justify-center text-stone-900 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <ChevronRight size={20} />
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); setActivePhotoIndex(prev => prev < selectedPlace.photos!.length - 1 ? prev + 1 : 0); }}
                          className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/80 rounded-full flex items-center justify-center text-stone-900 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <ChevronLeft size={20} />
                        </button>
                      </>
                    )}

                    <button onClick={() => setSelectedPlace(null)} className="absolute top-6 left-6 w-10 h-10 bg-white/80 rounded-full flex items-center justify-center text-stone-900 shadow-lg z-10"><X size={20} /></button>
                </div>
                <div className="w-full sm:w-1/2 p-6 sm:p-10 overflow-y-auto no-scrollbar text-right">
                    <div className="mb-6">
                      <h2 className="text-3xl font-black text-stone-900 dark:text-white mb-2">{selectedPlace.name}</h2>
                      <div className="flex items-center justify-end gap-2 text-stone-500 dark:text-stone-400">
                        <p className="text-sm font-medium">{selectedPlace.formatted_address}</p>
                        <MapPin size={16} className="flex-shrink-0 text-stone-300 dark:text-stone-600" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-8">
                        <div className="bg-stone-50 dark:bg-stone-800 p-5 rounded-3xl text-center border border-stone-100 dark:border-stone-700 shadow-sm">
                          <p className="text-[10px] font-black text-stone-400 dark:text-stone-500 uppercase tracking-widest mb-1">تقييم غوغل</p>
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-lg font-black text-stone-900 dark:text-white">{selectedPlace.rating || '---'}</span>
                            <Star size={16} className="text-amber-400 fill-amber-400" />
                          </div>
                        </div>
                        <button onClick={() => setShowSpecialRatingModal(true)} className="bg-stone-900 dark:bg-stone-800 p-5 rounded-3xl text-center text-white shadow-xl hover:scale-[1.02] transition-transform border border-stone-800 dark:border-stone-700">
                          <p className="text-[10px] font-black text-white/40 uppercase mb-1">التقييم الذكي</p>
                          <p className="text-lg font-black text-orange-400">{selectedPlace.internalRating?.toFixed(1) || '---'}</p>
                        </button>
                    </div>

                    <div className="flex flex-col gap-3 mb-10">
                      <a 
                        href={`https://www.google.com/maps/dir/?api=1&destination_place_id=${selectedPlace.place_id}`}
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="w-full py-5 bg-orange-500 text-white rounded-[1.5rem] font-black flex items-center justify-center gap-3 active:scale-95 transition-all text-sm shadow-lg shadow-orange-500/20"
                      >
                        <Navigation size={20} />
                        فتح في خرائط غوغل
                      </a>
                      
                      <div className="grid grid-cols-2 gap-3">
                        {selectedPlace.formatted_phone_number && (
                          <a 
                            href={`tel:${selectedPlace.formatted_phone_number}`}
                            className="py-4 bg-white dark:bg-stone-800 border border-stone-100 dark:border-stone-700 text-stone-900 dark:text-white rounded-[1.2rem] font-bold flex items-center justify-center gap-2 active:scale-95 transition-all text-xs"
                          >
                            <Phone size={16} className="text-emerald-500" />
                            اتصال هاتفي
                          </a>
                        )}
                        <button 
                          onClick={() => handleInviteFriend(selectedPlace)}
                          className="py-4 bg-white dark:bg-stone-800 border border-stone-100 dark:border-stone-700 text-stone-900 dark:text-white rounded-[1.2rem] font-bold flex items-center justify-center gap-2 active:scale-95 transition-all text-xs"
                        >
                          <Zap size={16} className="text-orange-500" />
                          عزيمة خويك
                        </button>
                      </div>
                    </div>

                    {selectedPlace.opening_hours?.weekday_text && (
                      <div className="mb-10 text-right bg-stone-50/50 dark:bg-stone-800/30 p-6 rounded-[2rem] border border-stone-100 dark:border-stone-800">
                        <div className="flex items-center justify-end gap-2 mb-4 text-stone-900 dark:text-white">
                          <h4 className="font-black text-sm">أوقات العمل</h4>
                          <Clock size={16} />
                        </div>
                        <div className="space-y-2">
                          {selectedPlace.opening_hours.weekday_text.map((day, i) => (
                            <p key={i} className="text-xs font-medium text-stone-500 dark:text-stone-400">
                              {day.replace(':', ' - ')}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    <div className="mt-12 space-y-6">
                        <h4 className="text-[10px] font-black uppercase text-stone-300 dark:text-stone-600 tracking-widest border-b dark:border-stone-800 pb-2">تفاعل مع المكان</h4>
                        <div className="grid grid-cols-3 gap-4">
                            <button onClick={() => user ? setShowReviewModal('review') : handleLogin()} className="flex flex-col items-center gap-2 p-4 bg-white dark:bg-stone-800 border border-stone-100 dark:border-stone-700 rounded-3xl hover:border-orange-200 dark:hover:border-orange-900 transition-all"><Star size={24} className="text-amber-500" /><span className="text-[10px] font-black dark:text-stone-400">تقييم</span></button>
                            <button onClick={() => user ? setShowReviewModal('photo') : handleLogin()} className="flex flex-col items-center gap-2 p-4 bg-white dark:bg-stone-800 border border-stone-100 dark:border-stone-700 rounded-3xl hover:border-blue-200 dark:hover:border-blue-900 transition-all"><Camera size={24} className="text-blue-500" /><span className="text-[10px] font-black dark:text-stone-400">صور</span></button>
                            <button onClick={() => user ? setShowReviewModal('review') : handleLogin()} className="flex flex-col items-center gap-2 p-4 bg-white dark:bg-stone-800 border border-stone-100 dark:border-stone-700 rounded-3xl hover:border-emerald-200 dark:hover:border-emerald-900 transition-all"><MessageSquare size={24} className="text-emerald-500" /><span className="text-[10px] font-black dark:text-stone-400">تجربة</span></button>
                        </div>
                    </div>
                </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showReviewModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowReviewModal(null)} className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" />
            <motion.div layoutId="review-modal" className="bg-white w-full max-w-lg rounded-[2.5rem] p-6 sm:p-10 shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]">
              <div className="overflow-y-auto no-scrollbar flex-1 text-right">
                <button onClick={() => setShowReviewModal(null)} className="absolute top-6 left-6 w-10 h-10 bg-stone-50 rounded-xl flex items-center justify-center text-stone-400 z-20"><X size={20} /></button>
                <div className="text-center mb-8 pt-4">
                   <div className={`w-20 h-20 rounded-3xl mx-auto flex items-center justify-center mb-5 ${showReviewModal === 'review' ? 'bg-amber-50 text-amber-500' : 'bg-blue-50 text-blue-500'}`}>{showReviewModal === 'review' ? <Star size={40} className="fill-amber-500" /> : <Camera size={40} />}</div>
                   <h2 className="text-3xl font-black text-stone-900 mb-2 leading-none">{showReviewModal === 'review' ? 'أضف تقييمك' : 'شاركنا صورة'}</h2>
                   <p className="text-stone-400 text-xs font-bold uppercase tracking-wider">{selectedPlace?.name}</p>
                </div>
                {showReviewModal === 'review' && (
                     <div className="space-y-6">
                        <div className="flex flex-col items-center gap-3">
                           <p className="text-[10px] font-black text-stone-400 uppercase tracking-[0.2em]">قيم تجربتك</p>
                           <div className="flex items-center gap-1">{[1, 2, 3, 4, 5].map(star => (<button key={star} onClick={() => setReviewForm(prev => ({ ...prev, rating: star }))} className="p-1 transition-all hover:scale-125"><Star size={38} className={`${star <= reviewForm.rating ? 'text-orange-500 fill-orange-500' : 'text-stone-100'}`} /></button>))}</div>
                        </div>
                        <div className="space-y-2">
                           <div className="flex justify-between items-center px-1"><p className="text-[10px] font-black text-stone-400 uppercase tracking-widest">تعليقك (اختياري)</p><span className="text-[10px] text-stone-300 font-bold">{reviewForm.comment.length}/500</span></div>
                           <textarea value={reviewForm.comment} onChange={(e) => setReviewForm(prev => ({ ...prev, comment: e.target.value.slice(0, 500) }))} placeholder="كيف كانت تجربتك؟ الأكل، الجو، الخدمة..." className="w-full h-36 bg-stone-50 rounded-[1.8rem] p-6 text-sm font-medium border border-stone-100 focus:ring-4 focus:ring-orange-500/5 text-right no-scrollbar" />
                        </div>
                     </div>
                )}
                <div className="space-y-4 mt-8">
                      <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">{showReviewModal === 'photo' ? 'اختر صورة من جهازك' : 'أضف صورة لتقييمك (اختياري)'}</p>
                      {reviewForm.photo ? (
                        <div className="relative aspect-video rounded-3xl overflow-hidden border-2 border-orange-500/10 group shadow-lg"><img src={reviewForm.photo} className="w-full h-full object-cover" alt="preview" /><div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"><button onClick={() => setReviewForm(prev => ({ ...prev, photo: '' }))} className="bg-white text-rose-500 px-5 py-2.5 rounded-full text-xs font-black">إزالة الصورة</button></div></div>
                      ) : (
                        <div className="relative group">
                          <input type="file" accept="image/*" onChange={handlePhotoUpload} className="absolute inset-0 opacity-0 cursor-pointer z-10" disabled={isUploadingPhoto} />
                          <div className="w-full border-2 border-dashed border-stone-200 rounded-3xl py-10 flex flex-col items-center justify-center gap-4 bg-stone-50/50 group-hover:bg-white transition-all"><div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-stone-300 shadow-sm">{isUploadingPhoto ? (<div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />) : (<Upload size={28} />)}</div><div className="text-center"><p className="text-xs font-black text-stone-800">{isUploadingPhoto ? 'جاري التحميل...' : 'اضغط لرفع صورة'}</p><p className="text-[10px] text-stone-400 font-bold mt-1">PNG, JPG حتى 10MB</p></div></div>
                        </div>
                      )}
                </div>
              </div>
              <div className="pt-8 mt-4 border-t border-stone-50 space-y-4">
                <p className="text-[10px] text-center text-stone-400 font-medium px-4">* تقييمك سيُنشر في مجتمع "وين يا أبو عبدالله" لمساعدة الآخرين، وليس له علاقة بتقييمات قوقل ماب الرسمية.</p>
                <button onClick={submitReview} disabled={isSubmittingReview || submitSuccess || isUploadingPhoto} className={`w-full py-5 rounded-[1.5rem] font-black uppercase tracking-[0.2em] text-sm shadow-xl transition-all active:scale-[0.98] flex items-center justify-center gap-3 ${isSubmittingReview || submitSuccess || isUploadingPhoto ? 'bg-emerald-50 text-emerald-500 cursor-not-allowed opacity-80' : 'bg-stone-900 text-white hover:bg-black'}`}>{isSubmittingReview || isUploadingPhoto ? (<div className="w-6 h-6 border-3 border-stone-300 border-t-emerald-500 rounded-full animate-spin" />) : submitSuccess ? (<><CheckCircle size={20} className="text-emerald-500" /><span>تم النشر بنجاح!</span></>) : (<><Zap size={18} className="text-orange-400 fill-orange-400" /><span>تأكيد ونشر التقييم</span><ArrowRight size={18} /></>)}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingReminder && (
          <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="fixed bottom-6 right-6 z-[100] w-[320px] sm:w-[400px]">
            <div className="bg-white rounded-[2rem] shadow-2xl border border-stone-100 p-5 overflow-hidden relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-500 to-amber-500" />
                <div className="flex items-start gap-4">
                   <div className="w-12 h-12 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-500"><Bell className="animate-bounce" size={24} /></div>
                   <div className="flex-1 text-right">
                      <h4 className="text-sm font-black mb-1">ذكرى رايقة؟</h4>
                      <p className="text-xs text-stone-500">زرت {pendingReminder.placeName} مؤخراً. وش رايك بتجربتك؟</p>
                   </div>
                   <button onClick={skipReminder} className="text-stone-300 hover:text-stone-500"><X size={18} /></button>
                </div>
                <div className="mt-4 flex gap-2">
                    <button onClick={openReminderRating} className="flex-1 bg-stone-900 text-white text-xs font-black py-3 rounded-xl">قيم الآن</button>
                    <button onClick={skipReminder} className="px-4 py-3 text-xs font-bold text-stone-400">لاحقاً</button>
                </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="hidden md:block py-20 bg-stone-950 text-white/40 text-center relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 relative z-10">
             <div className="w-16 h-16 bg-white rounded-3xl flex items-center justify-center mx-auto mb-6 p-2 shadow-2xl shadow-white/5"><Logo className="w-full h-full" /></div>
             <p className="text-[10px] font-black uppercase tracking-[0.5em] mb-4">وين يا أبو عبدالله؟</p>
             <p className="text-stone-700 text-[10px] max-w-xs mx-auto leading-relaxed">تطبيق مدعوم بخرائط غوغل لاكتشاف أفضل المطاعم والمقاهي حولك. © {new Date().getFullYear()}</p>
        </div>
      </footer>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-6 left-4 right-4 z-[100] bg-white/80 backdrop-blur-2xl border border-white/40 shadow-[0_20px_50px_rgba(0,0,0,0.15)] rounded-[2.5rem] p-2 flex items-center justify-between gap-1 overflow-hidden">
        <button 
          onClick={() => { 
            window.scrollTo({ top: 0, behavior: 'smooth' }); 
            setShowMoodSection(false); 
          }}
          className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-[2rem] transition-all ${viewMode === 'grid' && !showMoodSection && !showFavoritesOnly ? 'bg-orange-500 text-white shadow-lg' : 'text-stone-400'}`}
        >
          <Home size={20} />
          <span className="text-[9px] font-black uppercase tracking-tighter">الرئيسية</span>
        </button>

        <button 
          onClick={() => { 
            setViewMode('coverage');
            setShowMoodSection(false);
          }}
          className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-[2rem] transition-all ${viewMode === 'coverage' ? 'bg-indigo-600 text-white shadow-lg' : 'text-stone-400'}`}
        >
          <Camera size={20} />
          <span className="text-[9px] font-black uppercase tracking-tighter">تغطياتي</span>
        </button>
        
        <button 
          onClick={() => { 
            setShowMoodSection(!showMoodSection); 
            if (!showMoodSection) setTimeout(() => {
              document.getElementById('mood-section')?.scrollIntoView({ behavior: 'smooth' });
            }, 100);
          }}
          className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-[2rem] transition-all ${showMoodSection ? 'bg-stone-900 text-white shadow-lg' : 'text-stone-400'}`}
        >
          <Ghost size={20} className={showMoodSection ? 'animate-bounce' : ''} />
          <span className="text-[9px] font-black uppercase tracking-tighter">مزاجك</span>
        </button>

        <button 
          onClick={handleSurpriseMe}
          className="flex-1 flex flex-col items-center gap-1 py-3 text-emerald-500 rounded-[2rem] transition-all active:scale-90"
        >
          <Dices size={20} />
          <span className="text-[9px] font-black uppercase tracking-tighter">اختار لي</span>
        </button>

        <button 
          onClick={() => setViewMode(viewMode === 'grid' ? 'map' : 'grid')}
          className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-[2rem] transition-all ${viewMode === 'map' ? 'bg-blue-500 text-white shadow-lg' : 'text-stone-400'}`}
        >
          <MapViewIcon size={20} />
          <span className="text-[9px] font-black uppercase tracking-tighter">الخريطة</span>
        </button>
      </nav>

      {/* Floating Action Buttons */}
      <div className="fixed bottom-24 left-6 flex flex-col gap-4 z-[60]">
        <button 
          onClick={() => {
            console.log("Opening Wheel...");
            setShowWheel(true);
          }}
          className="w-16 h-16 bg-stone-900 dark:bg-orange-500 text-white rounded-full flex items-center justify-center shadow-[0_20px_50px_rgba(0,0,0,0.3)] hover:scale-110 active:scale-90 transition-all group relative border-4 border-white dark:border-stone-900"
          title="وين أروح؟"
        >
          <Dices size={28} className="group-hover:rotate-12 transition-transform" />
          <div className="absolute -top-2 -right-2 bg-rose-500 text-white text-[8px] font-black px-2 py-1 rounded-full animate-bounce">جديد</div>
        </button>
      </div>

      {/* Final Simple Modal Implementation */}
      {showWheel && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          {/* Backdrop */}
          <div 
            onClick={() => setShowWheel(false)} 
            style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', cursor: 'pointer' }}
          />
          
          {/* Content Box */}
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'relative', backgroundColor: 'white', width: '100%', maxWidth: '350px', borderRadius: '40px', padding: '40px 30px', textAlign: 'center', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', border: '1px solid #e5e7eb' }}
          >
            <div style={{ width: '80px', height: '80px', backgroundColor: '#fff7ed', borderRadius: '50%', margin: '0 auto 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '4px solid #ffedd5' }}>
              <Dices size={40} color="#f97316" className={isSpinning ? 'animate-spin' : ''} />
            </div>

            <h3 style={{ fontSize: '24px', fontWeight: 900, color: '#1c1917', marginBottom: '8px' }}>وين تبينا نوديك؟</h3>
            <p style={{ fontSize: '11px', color: '#78716c', marginBottom: '32px', fontWeight: 600 }}>أبو عبدالله بيختار لك أفضل مكان!</p>

            {winnerPlace ? (
              <div style={{ animation: 'scaleIn 0.3s ease-out' }}>
                <div style={{ backgroundColor: '#fff7ed', padding: '20px', borderRadius: '24px', marginBottom: '24px', border: '1px solid #ffedd5' }}>
                  <p style={{ fontSize: '10px', fontWeight: 900, color: '#f97316', textTransform: 'uppercase', marginBottom: '4px' }}>الوجهة المختارة:</p>
                  <h4 style={{ fontSize: '18px', fontWeight: 900, color: '#1c1917' }}>{winnerPlace.name}</h4>
                </div>
                <button 
                  onClick={() => { setSelectedPlace(winnerPlace); setShowWheel(false); setWinnerPlace(null); }}
                  style={{ width: '100%', padding: '16px', backgroundColor: '#1c1917', color: 'white', borderRadius: '16px', fontWeight: 900, border: 'none', cursor: 'pointer', marginBottom: '12px' }}
                >
                  وديني هناك الحين!
                </button>
                <button 
                  onClick={() => setWinnerPlace(null)}
                  style={{ backgroundColor: 'transparent', border: 'none', color: '#a8a29e', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                >
                  مو عاجبني.. غيره
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <button 
                  type="button"
                  disabled={isSpinning}
                  onClick={() => {
                    console.log("Spin button clicked");
                    handleSpin();
                  }}
                  style={{ 
                    width: '100%', 
                    padding: '20px', 
                    backgroundColor: isSpinning ? '#f5f5f4' : '#f97316', 
                    color: isSpinning ? '#d6d3d1' : 'white', 
                    borderRadius: '24px', 
                    fontSize: '18px', 
                    fontWeight: 900, 
                    border: 'none', 
                    cursor: 'pointer', 
                    boxShadow: '0 10px 15px -3px rgba(249, 115, 22, 0.3)',
                    WebkitTapHighlightColor: 'transparent',
                    touchAction: 'manipulation'
                  }}
                >
                  {isSpinning ? 'تحري الجودة...' : 'اختار لي مكان! 🎲'}
                </button>
                
                <button 
                  onClick={() => setShowWheel(false)}
                  style={{ backgroundColor: 'transparent', border: 'none', color: '#a8a29e', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '1px', cursor: 'pointer' }}
                >
                  إغلاق
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Custom Notification Admin Control (Admin Only) */}
      {isAdmin && (
        <div className="fixed bottom-24 right-6 flex flex-col items-end gap-3 z-[150]" dir="rtl">
          <AnimatePresence>
            {showNotifAdmin && (
              <motion.div 
                initial={{ opacity: 0, y: 20, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.9 }}
                className="bg-white dark:bg-stone-900 p-4 rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.2)] border border-stone-100 dark:border-stone-800 w-72 mb-2"
              >
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[10px] font-black text-stone-900 dark:text-stone-100 uppercase tracking-widest flex items-center gap-2">
                    <Shield size={10} className="text-orange-500" />
                    وحة التحكم (أدمن)
                  </h4>
                  <span className="text-[8px] bg-orange-100 dark:bg-orange-900/40 text-orange-600 px-2 py-0.5 rounded-full font-black">أبو عبدالله</span>
                </div>
                <textarea 
                  value={notifInput}
                  onChange={(e) => setNotifInput(e.target.value)}
                  placeholder="اكتب رسالتك لـ أبو عبدالله..."
                  className="w-full h-24 bg-stone-50 dark:bg-stone-800 border-none rounded-2xl p-4 text-xs resize-none mb-3 focus:ring-2 focus:ring-orange-500 transition-all outline-none dark:text-stone-200"
                />
                <div className="flex gap-2">
                  <button 
                    onClick={() => {
                      if (notifInput.trim()) {
                        addNotification(notifInput, 'info');
                        setNotifInput('');
                        setShowNotifAdmin(false);
                      }
                    }}
                    className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl text-[10px] font-black transition-all active:scale-95"
                  >
                    إرسال إشعار عام
                  </button>
                  <button 
                    onClick={() => setShowNotifAdmin(false)}
                    className="px-4 bg-stone-100 dark:bg-stone-800 text-stone-500 rounded-xl text-[10px]"
                  >
                    إلغاء
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          
          <button 
            onClick={(e) => { e.stopPropagation(); setShowNotifAdmin(!showNotifAdmin); }}
            className="w-16 h-16 bg-white dark:bg-stone-900 border-4 border-white dark:border-stone-900 rounded-full flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-all text-orange-500 relative"
          >
            <Bell size={24} className={showNotifAdmin ? 'animate-bounce' : ''} />
            {!showNotifAdmin && <div className="absolute top-1 right-1 w-3 h-3 bg-rose-500 rounded-full border-2 border-white dark:border-stone-900" />}
          </button>
        </div>
      )}

      {/* Notifications Toast Stack */}
      <div className="fixed top-8 inset-x-0 flex flex-col items-center gap-3 z-[10000] pointer-events-none px-6" dir="rtl">
        <AnimatePresence>
          {notifications.map((notif) => (
            <motion.div 
              key={notif.id}
              initial={{ opacity: 0, y: -50, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5, y: -20, transition: { duration: 0.2 } }}
              className="pointer-events-auto bg-white/9 worst-blur dark:bg-stone-900/90 backdrop-blur-2xl border border-white dark:border-stone-800/50 py-4 px-6 rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.2)] flex items-center gap-4 max-w-md w-full relative group overflow-hidden"
            >
              <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-orange-500" />
              <div className="w-10 h-10 rounded-2xl bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center flex-shrink-0 animate-pulse">
                <Sparkles size={18} className="text-orange-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-black text-stone-900 dark:text-stone-100 leading-relaxed">
                  {notif.message}
                </p>
              </div>
              <button 
                onClick={() => setNotifications(prev => prev.filter(n => n.id !== notif.id))}
                className="text-stone-300 hover:text-stone-900 dark:hover:text-white transition-colors p-1"
              >
                <X size={16} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

        {viewMode === 'coverage' && (
          <div className="fixed bottom-24 right-24 z-[150]" dir="rtl">
            <button 
              onClick={() => addNotification('أبو عبدالله يرحب بكم في قسم التغطيات الحصرية!', 'info')}
              className="w-16 h-16 bg-indigo-600 border-4 border-white dark:border-stone-900 rounded-full flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-all text-white"
            >
              <Camera size={26} />
            </button>
          </div>
        )}

      {/* Add Coverage Post Modal */}
      <AnimatePresence>
        {showAddMediaModal && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4" dir="rtl">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setShowAddMediaModal(false)} 
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 30 }} 
              animate={{ scale: 1, opacity: 1, y: 0 }} 
              exit={{ scale: 0.9, opacity: 0, y: 30 }}
              className="relative w-full max-w-2xl bg-white dark:bg-stone-900 rounded-[3rem] p-10 shadow-2xl border border-stone-200 dark:border-stone-800 overflow-y-auto max-h-[90vh] no-scrollbar"
            >
              <div className="flex items-center gap-4 mb-8">
                <div className="w-14 h-14 bg-indigo-600 rounded-3xl flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
                  <Plus size={28} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-stone-900 dark:text-white">إطلاق تغطية جديدة</h3>
                  <p className="text-xs text-stone-400 font-bold">شاركنا جولتك الحصرية الحين يا أبو عبدالله</p>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-black text-stone-900 dark:text-stone-100 mb-3 mr-2">عنوان التغطية</label>
                  <input 
                    type="text"
                    value={newPostData.title}
                    onChange={(e) => setNewPostData(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="مثال: تجربتي في افتتاح مطعم السفير..."
                    className="w-full bg-stone-50 dark:bg-stone-800 border-none rounded-2xl p-5 text-sm font-medium outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-stone-900 dark:text-stone-100 mb-3 mr-2">تقرير الزيارة (المدونة)</label>
                  <textarea 
                    value={newPostData.description}
                    onChange={(e) => setNewPostData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="اكتب تفاصيل الزيارة ورأيك الشخصي بكل أمانة..."
                    className="w-full h-32 bg-stone-50 dark:bg-stone-800 border-none rounded-2xl p-5 text-sm font-medium outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all dark:text-white resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-stone-900 dark:text-stone-100 mb-3 mr-2">رفع الوسائط (صور وفيديوهات متعددة)</label>
                  <p className="text-[9px] text-amber-600 dark:text-amber-400 font-bold mb-3 mr-2">* تنبيه: تم رفع الحد الأقصى للفيديوهات ليكون مفتوحاً (حتى ٢٠ ميجابايت) لضمان أفضل جودة لمتابعيك يا أبو عبدالله.</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                    {newPostData.media.map((m, idx) => (
                      <div key={idx} className="relative aspect-square rounded-2xl overflow-hidden border border-stone-100 dark:border-stone-800">
                        {m.type === 'image' ? (
                          <img src={m.url} className="w-full h-full object-cover" alt="" />
                        ) : (
                          <video src={m.url} className="w-full h-full object-cover" muted autoPlay playsInline loop />
                        )}
                        <button 
                          onClick={() => setNewPostData(prev => ({ ...prev, media: prev.media.filter((_, i) => i !== idx) }))}
                          className="absolute top-2 left-2 bg-rose-500 text-white p-1.5 rounded-lg shadow-lg"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                    <label className="aspect-square flex flex-col items-center justify-center border-2 border-dashed border-stone-200 dark:border-stone-800 rounded-2xl hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-all cursor-pointer group">
                      <input 
                        type="file" 
                        multiple 
                        accept="image/*,video/*"
                        className="hidden"
                        onChange={async (e) => {
                          const files = Array.from(e.target.files || []) as File[];
                          const convertToBase64 = (file: File): Promise<string> => {
                            return new Promise((resolve, reject) => {
                              const reader = new FileReader();
                              reader.readAsDataURL(file);
                              reader.onload = () => resolve(reader.result as string);
                              reader.onerror = error => reject(error);
                            });
                          };

                          const newMediaPromises = files.map(async (file) => {
                            const isVideo = file.type.startsWith('video');
                            const limit = isVideo ? 20 * 1024 * 1024 : 10 * 1024 * 1024; // 20MB for video, 10MB for image
                            
                            if (file.size > limit) { 
                              throw new Error(`الملف ${file.name} كبير جداً، الحد الأقصى ${isVideo ? '٢٠ ميجابايت للفيديو' : '١٠ ميجابايت للصورة'}`);
                            }
                            const base64 = await convertToBase64(file);
                            return {
                              type: isVideo ? 'video' : 'image' as 'image' | 'video',
                              url: base64
                            };
                          });

                          try {
                            const newMedia = await Promise.all(newMediaPromises);
                            setNewPostData(prev => ({ ...prev, media: [...prev.media, ...newMedia] }));
                          } catch (err: any) {
                            addNotification(err.message, 'error');
                          }
                        }}
                      />
                      <Upload size={24} className="text-stone-300 mb-2 group-hover:scale-110 transition-transform" />
                      <span className="text-[10px] font-black text-stone-400">إضافة ملفات</span>
                    </label>
                  </div>
                </div>

                <div className="flex gap-4 pt-4">
                  <button 
                    disabled={loading}
                    onClick={async () => {
                      if (!newPostData.title || !newPostData.description || newPostData.media.length === 0) {
                        addNotification('يا غالي لازم تعبي البيانات وترفع صورة أو فيديو على الأقل!', 'warning');
                        return;
                      }

                      setLoading(true);
                      try {
                        const postsRef = collection(db, 'coveragePosts');
                        const postDoc = await addDoc(postsRef, {
                          title: newPostData.title,
                          description: newPostData.description,
                          createdAt: serverTimestamp(),
                          authorId: user?.uid,
                          authorName: user?.displayName,
                          mediaCount: newPostData.media.length
                        });

                        // Upload media and its chunks
                        for (let i = 0; i < newPostData.media.length; i++) {
                          await uploadChunkedMedia(postDoc.id, newPostData.media[i], i);
                        }
                        
                        setShowAddMediaModal(false);
                        setNewPostData({ title: '', description: '', media: [] });
                        addNotification('الله يبارك فيك! تم نشر التغطية بنجاح يا أبو عبدالله 📸', 'success');
                      } catch (err) {
                        handleFirestoreError(err, OperationType.WRITE, 'coveragePosts');
                      } finally {
                        setLoading(false);
                      }
                    }}
                    className="flex-1 py-5 bg-indigo-600 text-white rounded-2xl text-sm font-black shadow-2xl hover:shadow-indigo-500/30 active:scale-95 transition-all disabled:opacity-50"
                  >
                    {loading ? <RotateCw className="animate-spin mx-auto" size={20} /> : 'نشر التدوينة الحين'}
                  </button>
                  <button 
                    onClick={() => setShowAddMediaModal(false)}
                    className="px-8 py-5 bg-stone-100 dark:bg-stone-800 text-stone-500 rounded-2xl text-sm font-bold"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .mask-fade-edges { mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent); }
        .animate-spin-slow { animation: spin 3s linear infinite; }
        .dark { color-scheme: dark; }
      `}</style>
    </div>
  );
}

const mapStyles = [
  { "elementType": "geometry", "stylers": [{ "color": "#f5f5f5" }] },
  { "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#616161" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#f5f5f5" }] },
  { "featureType": "administrative.land_parcel", "elementType": "labels.text.fill", "stylers": [{ "color": "#bdbdbd" }] },
  { "featureType": "poi", "elementType": "geometry", "stylers": [{ "color": "#eeeeee" }] },
  { "featureType": "poi", "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
  { "featureType": "poi.park", "elementType": "geometry", "stylers": [{ "color": "#e5e5e5" }] },
  { "featureType": "poi.park", "elementType": "labels.text.fill", "stylers": [{ "color": "#9e9e9e" }] },
  { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#ffffff" }] },
  { "featureType": "road.arterial", "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
  { "featureType": "road.highway", "elementType": "geometry", "stylers": [{ "color": "#dadada" }] },
  { "featureType": "road.highway", "elementType": "labels.text.fill", "stylers": [{ "color": "#616161" }] },
  { "featureType": "road.local", "elementType": "labels.text.fill", "stylers": [{ "color": "#9e9e9e" }] },
  { "featureType": "transit.line", "elementType": "geometry", "stylers": [{ "color": "#e5e5e5" }] },
  { "featureType": "transit.station", "elementType": "geometry", "stylers": [{ "color": "#eeeeee" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#c9c9c9" }] },
  { "featureType": "water", "elementType": "labels.text.fill", "stylers": [{ "color": "#9e9e9e" }] }
];
