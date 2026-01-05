import CommunityHealth from "./CommunityHealth";
import ResearchConfig from "./ResearchConfig";
import FeatureFlags from "./FeatureFlags";
import Layout from "./Layout.jsx";

import Home from "./Home";

import CreateMovement from "./CreateMovement";

import MovementDetails from "./MovementDetails";

import Profile from "./Profile";

import DailyChallenges from "./DailyChallenges";

import TermsOfService from "./TermsOfService";

import ContentPolicy from "./ContentPolicy";

import CommunityGuidelines from "./CommunityGuidelines";

import LegalHub from "./LegalHub";

import SafetyFAQ from "./SafetyFAQ";

import PrivacyPolicy from "./PrivacyPolicy";

import AdminReports from "./AdminReports";

import UserProfile from "./UserProfile";

import MessagesComingSoon from "./MessagesComingSoon";

import Notifications from "./Notifications";

import CollaborationInvites from "./CollaborationInvites";

import Leaderboard from "./Leaderboard";

import AdminDashboard from "./AdminDashboard";
import AdminChallenges from "./AdminChallenges";

import AdminIncidentLog from "./AdminIncidentLog";

import RequireAdmin from "@/components/auth/RequireAdmin";
import RequireStaff from "@/components/auth/RequireStaff";
import SystemHealth from "./SystemHealth";

import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';

const PAGES = {
    
    Home: Home,
    
    CreateMovement: CreateMovement,
    
    MovementDetails: MovementDetails,
    
    Profile: Profile,
    
    DailyChallenges: DailyChallenges,
    
    TermsOfService: TermsOfService,
    
    ContentPolicy: ContentPolicy,
    
    CommunityGuidelines: CommunityGuidelines,
    
    LegalHub: LegalHub,

    SafetyFAQ: SafetyFAQ,

    PrivacyPolicy: PrivacyPolicy,
    
    AdminReports: AdminReports,
    
    UserProfile: UserProfile,
    
    Messages: MessagesComingSoon,
    
    Notifications: Notifications,
    
    CollaborationInvites: CollaborationInvites,
    
    Leaderboard: Leaderboard,
    
    AdminDashboard: AdminDashboard,

    AdminChallenges: AdminChallenges,

    AdminIncidentLog: AdminIncidentLog,
    
}

function _getCurrentPage(url) {
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    let urlLastPart = url.split('/').pop();
    if (urlLastPart.includes('?')) {
        urlLastPart = urlLastPart.split('?')[0];
    }

    const pageName = Object.keys(PAGES).find(page => page.toLowerCase() === urlLastPart.toLowerCase());
    return pageName || Object.keys(PAGES)[0];
}

// Create a wrapper component that uses useLocation inside the Router context
function PagesContent() {
    const location = useLocation();
    const currentPage = _getCurrentPage(location.pathname);
    
    return (
        <Layout currentPageName={currentPage}>
            <Routes>            
                
                    <Route path="/" element={<Home />} />
                
                
                <Route path="/Home" element={<Home />} />
                
                <Route path="/CreateMovement" element={<CreateMovement />} />
                
                <Route path="/MovementDetails" element={<MovementDetails />} />
                
                <Route path="/Profile" element={<Profile />} />
                
                <Route path="/DailyChallenges" element={<DailyChallenges />} />
                
                <Route path="/TermsOfService" element={<TermsOfService />} />
                
                <Route path="/ContentPolicy" element={<ContentPolicy />} />
                
                <Route path="/CommunityGuidelines" element={<CommunityGuidelines />} />
                
                <Route path="/LegalHub" element={<LegalHub />} />

                <Route path="/SafetyFAQ" element={<SafetyFAQ />} />

                <Route path="/PrivacyPolicy" element={<PrivacyPolicy />} />

                {/* Route aliases for the LegalHub links */}
                <Route path="/legal-hub" element={<LegalHub />} />
                <Route path="/terms-of-service" element={<TermsOfService />} />
                <Route path="/content-policy" element={<ContentPolicy />} />
                <Route path="/community-guidelines" element={<CommunityGuidelines />} />
                <Route path="/safety-faq" element={<SafetyFAQ />} />
                <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                
                <Route
                    path="/CommunityHealth"
                    element={
                        <RequireAdmin>
                            <CommunityHealth />
                        </RequireAdmin>
                    }
                />
                <Route
                    path="/ResearchConfig"
                    element={
                        <RequireAdmin>
                            <ResearchConfig />
                        </RequireAdmin>
                    }
                />
                <Route
                    path="/FeatureFlags"
                    element={
                        <RequireAdmin>
                            <FeatureFlags />
                        </RequireAdmin>
                    }
                />
                <Route
                    path="/AdminReports"
                    element={
                        <RequireStaff>
                            <AdminReports />
                        </RequireStaff>
                    }
                />
                
                <Route path="/UserProfile" element={<UserProfile />} />
                
                <Route path="/Messages" element={<MessagesComingSoon />} />
                
                <Route path="/Notifications" element={<Notifications />} />
                
                <Route path="/CollaborationInvites" element={<CollaborationInvites />} />
                
                <Route path="/Leaderboard" element={<Leaderboard />} />
                

                <Route
                    path="/AdminDashboard"
                    element={
                        <RequireAdmin>
                            <AdminDashboard />
                        </RequireAdmin>
                    }
                />

                <Route
                    path="/AdminChallenges"
                    element={
                        <RequireAdmin>
                            <AdminChallenges />
                        </RequireAdmin>
                    }
                />

                <Route
                    path="/SystemHealth"
                    element={
                        <RequireAdmin>
                            <SystemHealth />
                        </RequireAdmin>
                    }
                />

                <Route
                    path="/AdminIncidentLog"
                    element={
                        <RequireStaff>
                            <AdminIncidentLog />
                        </RequireStaff>
                    }
                />
                
            </Routes>
        </Layout>
    );
}

export default function Pages() {
    return (
        <Router>
            <PagesContent />
        </Router>
    );
}
