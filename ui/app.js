// ============================================================================
// Tauri API
// ============================================================================
const { invoke } = window.__TAURI__.core;

// ============================================================================
// App Version (zentral definiert, muss nur hier aktualisiert werden)
// ============================================================================
const APP_VERSION = '2.0.0';

// ============================================================================
// Security: HTML Escape Function (XSS Prevention)
// ============================================================================
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

// ============================================================================
// Chart Theme Colors (centralized)
// ============================================================================
function getAccentColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f59e0b';
}

function getChartThemeColors() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const style = getComputedStyle(document.documentElement);
    return {
        isDark,
        textColor: style.getPropertyValue('--text-secondary').trim(),
        gridColor: style.getPropertyValue('--border').trim(),
        accentPrimary: style.getPropertyValue('--accent').trim(),
        accentPrimaryLight: style.getPropertyValue('--accent-muted').trim(),
        accentSuccess: style.getPropertyValue('--success').trim(),
        accentWarning: style.getPropertyValue('--warning').trim(),
        accentDanger: style.getPropertyValue('--danger').trim(),
        tooltipBg: style.getPropertyValue('--bg-surface').trim(),
        tooltipText: style.getPropertyValue('--text-primary').trim(),
        tooltipBorder: style.getPropertyValue('--border').trim(),
    };
}

function getChartColors() {
    const accent = getAccentColor();
    return [
        accent, '#10b981', '#3b82f6', '#ef4444', '#06b6d4',
        '#8b5cf6', '#ec4899', '#14b8a6', '#84cc16', '#f43f5e',
        '#a855f7', '#0ea5e9',
    ];
}

const CHART_COLORS = getChartColors();

// ============================================================================
// State
// ============================================================================
let state = {
    antworten: {},      // Object: { frage_id: value } - ID-basiert für korrekte Zuordnung
    kommentare: {},     // Object: { gruppe_name: kommentar } - Gruppenbasiert
    lieferanten: [],
    seTeams: [],
    gruppen: [],
    fragen: [],
    deleteId: null,
    editId: null,
    editBewertung: null,
    editFrageId: null,
    selectedDate: new Date(),
    datePickerMonth: new Date(),
    groupsExpanded: true,
    currentUser: null,
    confirmAction: null, // Callback for confirm modal
    promptAction: null, // Callback for prompt modal
    // Loaded Bewertung State (für Speicher-Button Deaktivierung)
    isLoadedBewertung: false,
    loadedBewertungDate: null,  // Original-Datum der geladenen Bewertung
    // Historie Views
    currentHistorieView: 'table',
    historieData: [], // Cached historie data for views
    historiePage: 1,
    historiePageSize: 50,
    trendLineChartInstance: null,
    trendBarChartInstance: null,
    kategorieTrendChartInstance: null,
    compareRadarChartInstance: null,
    selectedTrendLieferant: null,
    selectedCompare1: null,
    selectedCompare2: null,
    // Cross-DB Vergleich
    crossDbMode: false,
    crossDbSources: [],
    crossDbEntries: [],
    crossDbAllEntries: [],
    crossDbSelectedSupplier: null,
    crossDbCategoryChartInstance: null,
    crossDbTrendChartInstance: null,
    // Multi-Select for Line Chart
    multiSelectLieferanten: ['__average__'], // Array of selected suppliers (default: average only)
    multiSelectOpen: false,
    // Dashboard Donut Chart
    dashboardDonutChartInstance: null,
    // Dashboard Data (für Detail-Modals)
    dashboardData: null,
    // Settings (Schwellenwerte)
    settings: {
        threshold_success: 75.0,
        threshold_warning: 50.0,
        dashboard_top_limit: 5,
        dashboard_recent_limit: 5,
        dashboard_critical_limit: 10,
        backup_retention_days: 30
    },
    // Strukturierte Maßnahmen (Phase 2)
    pendingMassnahmen: [], // Temporäre Maßnahmen vor dem Speichern
    // Vorquartal Maßnahmen
    vorquartalMassnahmen: null,
    vorquartalPanelDismissed: false,
    vorquartalDismissedFor: null,
    // Dashboard Timeframe
    dashboardTimeframe: 'quarter', // Default: Dieses Quartal
    dashboardCustomStart: null,
    dashboardCustomEnd: null,
    // Date Range Picker State
    dateRangeStartMonth: new Date(),
    dateRangeEndMonth: new Date(),
    dateRangeStartDate: null,
    dateRangeEndDate: null,
    // PDF Logo Base64
    pdfLogoBase64: null,
    // Loading Flags (Race Condition Protection)
    isLoadingDashboard: false,
    isLoadingHistorie: false,
    historieLoadGeneration: 0,
    isLoadingVorquartal: false,
    isLoadingBewertung: false,
    // Doppelklick-Schutz Flags
    _skipDuplicateCheck: false,
    isSaving: false,
    isDeleting: false,
    isLoggingIn: false,
    isGeneratingPdf: false,
    // Phase 6: Ziele & Sollwerte
    zieleData: [],
    editZielId: null
};

// ============================================================================
// Load PDF Logo as Base64
// ============================================================================
async function loadPdfLogo() {
    try {
        const response = await fetch('logo-big.png');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                state.pdfLogoBase64 = reader.result;
                resolve(true);
            };
            reader.onerror = () => {
                reject(new Error('FileReader error'));
            };
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.error('Could not load PDF logo:', e);
        state.pdfLogoBase64 = null;
        return false;
    }
}

// ============================================================================
// DOM Elements
// ============================================================================
const elements = {
    // Navigation
    navBtns: document.querySelectorAll('.sidebar-nav-btn'),
    views: document.querySelectorAll('.view'),
    sidebar: document.getElementById('sidebar'),
    sidebarCollapseBtn: document.getElementById('sidebarCollapseBtn'),
    sidebarSettingsBtn: document.getElementById('sidebarSettingsBtn'),
    sidebarToggleBtn: document.getElementById('sidebarToggleBtn'),
    headerTitle: document.getElementById('headerTitle'),

    // Dashboard View
    dashboardQuartalLabel: document.getElementById('dashboardQuartalLabel'),
    dashboardBewertungenQuartal: document.getElementById('dashboardBewertungenQuartal'),
    dashboardDurchschnitt: document.getElementById('dashboardDurchschnitt'),
    dashboardLieferanten: document.getElementById('dashboardLieferanten'),
    dashboardKritische: document.getElementById('dashboardKritische'),
    // KPI Cards (alle klickbar)
    dashboardBewertungenCard: document.getElementById('dashboardBewertungenCard'),
    dashboardDurchschnittCard: document.getElementById('dashboardDurchschnittCard'),
    dashboardLieferantenCard: document.getElementById('dashboardLieferantenCard'),
    dashboardKritischeCard: document.getElementById('dashboardKritischeCard'),
    dashboardTopPerformer: document.getElementById('dashboardTopPerformer'),
    dashboardLetzteBewertungen: document.getElementById('dashboardLetzteBewertungen'),
    dashboardProgressWidget: document.getElementById('dashboardProgressWidget'),
    progressQuartalLabel: document.getElementById('progressQuartalLabel'),
    progressWidgetCount: document.getElementById('progressWidgetCount'),
    progressWidgetFill: document.getElementById('progressWidgetFill'),
    progressWidgetPercent: document.getElementById('progressWidgetPercent'),
    dashboardMissingBanner: document.getElementById('dashboardMissingBanner'),
    missingQuartalLabel: document.getElementById('missingQuartalLabel'),
    missingBannerList: document.getElementById('missingBannerList'),
    startBewertungBtn: document.getElementById('startBewertungBtn'),
    dashboardOffeneMassnahmen: document.getElementById('dashboardOffeneMassnahmen'),
    dashboardDonutChart: document.getElementById('dashboardDonutChart'),
    dashboardDonutLegend: document.getElementById('dashboardDonutLegend'),
    donutGruen: document.getElementById('donutGruen'),
    donutGelb: document.getElementById('donutGelb'),
    donutRot: document.getElementById('donutRot'),
    // Lieferanten Detail Modal
    lieferantenDetailModal: document.getElementById('lieferantenDetailModal'),
    lieferantenDetailIcon: document.getElementById('lieferantenDetailIcon'),
    lieferantenDetailTitle: document.getElementById('lieferantenDetailTitle'),
    lieferantenDetailList: document.getElementById('lieferantenDetailList'),
    closeLieferantenDetail: document.getElementById('closeLieferantenDetail'),

    // Dashboard Timeframe Filter
    dashboardTimeframeWrapper: document.getElementById('dashboardTimeframeWrapper'),
    dashboardTimeframeBtn: document.getElementById('dashboardTimeframeBtn'),
    dashboardTimeframeLabel: document.getElementById('dashboardTimeframeLabel'),
    dashboardTimeframeDropdown: document.getElementById('dashboardTimeframeDropdown'),
    dashboardRefreshBtn: document.getElementById('dashboardRefreshBtn'),

    // Date Range Modal
    dateRangeModal: document.getElementById('dateRangeModal'),
    dateRangeStart: document.getElementById('dateRangeStart'),
    dateRangeEnd: document.getElementById('dateRangeEnd'),
    dateRangeStartInput: document.getElementById('dateRangeStartInput'),
    dateRangeEndInput: document.getElementById('dateRangeEndInput'),
    dateRangeStartWrapper: document.getElementById('dateRangeStartWrapper'),
    dateRangeEndWrapper: document.getElementById('dateRangeEndWrapper'),
    dateRangeStartDropdown: document.getElementById('dateRangeStartDropdown'),
    dateRangeEndDropdown: document.getElementById('dateRangeEndDropdown'),
    dateRangeStartTitle: document.getElementById('dateRangeStartTitle'),
    dateRangeEndTitle: document.getElementById('dateRangeEndTitle'),
    dateRangeStartDays: document.getElementById('dateRangeStartDays'),
    dateRangeEndDays: document.getElementById('dateRangeEndDays'),
    dateRangeStartPrevMonth: document.getElementById('dateRangeStartPrevMonth'),
    dateRangeStartNextMonth: document.getElementById('dateRangeStartNextMonth'),
    dateRangeEndPrevMonth: document.getElementById('dateRangeEndPrevMonth'),
    dateRangeEndNextMonth: document.getElementById('dateRangeEndNextMonth'),
    cancelDateRange: document.getElementById('cancelDateRange'),
    applyDateRange: document.getElementById('applyDateRange'),

    // Vorquartal Maßnahmen Panel
    vorquartalPanel: document.getElementById('vorquartalPanel'),
    vorquartalQuartal: document.getElementById('vorquartalQuartal'),
    vorquartalDate: document.getElementById('vorquartalDate'),
    vorquartalResult: document.getElementById('vorquartalResult'),
    vorquartalText: document.getElementById('vorquartalText'),
    vorquartalUmgesetzt: document.getElementById('vorquartalUmgesetzt'),
    vorquartalCloseBtn: document.getElementById('vorquartalCloseBtn'),

    // Bewertung View
    lieferantSelect: document.getElementById('lieferantSelect'),
    lieferantInput: document.getElementById('lieferantInput'),
    lieferantWrapper: document.getElementById('lieferantWrapper'),
    lieferantDropdown: document.getElementById('lieferantDropdown'),
    seTeamInput: document.getElementById('seTeamInput'),
    seTeamWrapper: document.getElementById('seTeamWrapper'),
    seTeamDropdown: document.getElementById('seTeamDropdown'),
    addSeTeamBtn: document.getElementById('addSeTeamBtn'),
    datumInput: document.getElementById('datumInput'),
    questionsContainer: document.getElementById('questionsContainer'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    resultValue: document.getElementById('resultValue'),
    saveBtn: document.getElementById('saveBtn'),
    resetBtn: document.getElementById('resetBtn'),
    addLieferantBtn: document.getElementById('addLieferantBtn'),
    toggleGroupsBtn: document.getElementById('toggleGroupsBtn'),
    toggleGroupsText: document.getElementById('toggleGroupsText'),
    toggleGroupsIcon: document.getElementById('toggleGroupsIcon'),
    bestellnummerInput: document.getElementById('bestellnummerInput'),
    massnahmenInput: document.getElementById('massnahmenInput'),
    massnahmenBtn: document.getElementById('massnahmenBtn'),
    massnahmenPanel: document.getElementById('massnahmenPanel'),
    massnahmenCloseBtn: document.getElementById('massnahmenCloseBtn'),
    massnahmenIndicator: document.getElementById('massnahmenIndicator'),
    massnahmenListe: document.getElementById('massnahmenListe'),
    massnahmeDesc: document.getElementById('massnahmeDesc'),
    massnahmeVerantw: document.getElementById('massnahmeVerantw'),
    massnahmeFaellig: document.getElementById('massnahmeFaellig'),
    massnahmeAddBtn: document.getElementById('massnahmeAddBtn'),

    // Date Picker
    datePickerWrapper: document.getElementById('datePickerWrapper'),
    datePickerDropdown: document.getElementById('datePickerDropdown'),
    datePickerTitle: document.getElementById('datePickerTitle'),
    datePickerDays: document.getElementById('datePickerDays'),
    datePrevMonth: document.getElementById('datePrevMonth'),
    dateNextMonth: document.getElementById('dateNextMonth'),

    // Historie View
    historieFilter: document.getElementById('historieFilter'),
    historieFilterInput: document.getElementById('historieFilterInput'),
    historieFilterWrapper: document.getElementById('historieFilterWrapper'),
    historieFilterDropdown: document.getElementById('historieFilterDropdown'),
    historieSeTeamFilter: document.getElementById('historieSeTeamFilter'),
    historieSeTeamFilterInput: document.getElementById('historieSeTeamFilterInput'),
    historieSeTeamFilterWrapper: document.getElementById('historieSeTeamFilterWrapper'),
    historieSeTeamFilterDropdown: document.getElementById('historieSeTeamFilterDropdown'),
    historieJahrFilter: document.getElementById('historieJahrFilter'),
    historieJahrFilterInput: document.getElementById('historieJahrFilterInput'),
    historieJahrFilterWrapper: document.getElementById('historieJahrFilterWrapper'),
    historieJahrFilterDropdown: document.getElementById('historieJahrFilterDropdown'),
    historieQuartalFilter: document.getElementById('historieQuartalFilter'),
    historieQuartalFilterInput: document.getElementById('historieQuartalFilterInput'),
    historieQuartalFilterWrapper: document.getElementById('historieQuartalFilterWrapper'),
    historieQuartalFilterDropdown: document.getElementById('historieQuartalFilterDropdown'),
    historieBody: document.getElementById('historieBody'),
    resetHistorieFilters: document.getElementById('resetHistorieFilters'),
    sevalIdSearch: document.getElementById('sevalIdSearch'),
    sevalIdSearchClear: document.getElementById('sevalIdSearchClear'),
    historieTable: document.getElementById('historieTable'),
    historieEmpty: document.getElementById('historieEmpty'),
    historieCount: document.getElementById('historieCount'),
    refreshHistorie: document.getElementById('refreshHistorie'),
    newFromHistorie: document.getElementById('newFromHistorie'),
    historiePagination: document.getElementById('historiePagination'),
    paginationInfo: document.getElementById('paginationInfo'),
    paginationControls: document.getElementById('paginationControls'),
    historiePageSizeSelect: document.getElementById('historiePageSize'),

    // Modals
    lieferantModal: document.getElementById('lieferantModal'),
    newLieferantInput: document.getElementById('newLieferantInput'),
    lieferantListContainer: document.getElementById('lieferantList'),
    cancelLieferant: document.getElementById('cancelLieferant'),
    confirmLieferant: document.getElementById('confirmLieferant'),

    deleteModal: document.getElementById('deleteModal'),
    cancelDelete: document.getElementById('cancelDelete'),
    confirmDelete: document.getElementById('confirmDelete'),

    successModal: document.getElementById('successModal'),
    successMessage: document.getElementById('successMessage'),
    confirmSuccess: document.getElementById('confirmSuccess'),

    errorModal: document.getElementById('errorModal'),
    errorMessage: document.getElementById('errorMessage'),
    confirmError: document.getElementById('confirmError'),

    confirmModal: document.getElementById('confirmModal'),
    confirmTitle: document.getElementById('confirmTitle'),
    confirmMessage: document.getElementById('confirmMessage'),
    cancelConfirm: document.getElementById('cancelConfirm'),
    confirmConfirm: document.getElementById('confirmConfirm'),

    promptModal: document.getElementById('promptModal'),
    promptTitle: document.getElementById('promptTitle'),
    promptInput: document.getElementById('promptInput'),
    cancelPrompt: document.getElementById('cancelPrompt'),
    confirmPrompt: document.getElementById('confirmPrompt'),

    editModal: document.getElementById('editModal'),
    editLieferant: document.getElementById('editLieferant'),
    editSeTeam: document.getElementById('editSeTeam'),
    editDatum: document.getElementById('editDatum'),
    editErgebnis: document.getElementById('editErgebnis'),
    editBestellnummer: document.getElementById('editBestellnummer'),
    editKommentareContainer: document.getElementById('editKommentareContainer'),
    cancelEdit: document.getElementById('cancelEdit'),
    confirmEdit: document.getElementById('confirmEdit'),

    // About Modal
    aboutModal: document.getElementById('aboutModal'),
    aboutToggle: document.getElementById('aboutToggle'),
    closeAbout: document.getElementById('closeAbout'),
    appVersion: document.getElementById('appVersion'),

    // Changelog Modal
    changelogModal: document.getElementById('changelogModal'),
    closeChangelog: document.getElementById('closeChangelog'),

    // Settings View
    settingsUsername: document.getElementById('settingsUsername'),
    settingsUserRole: document.getElementById('settingsUserRole'),
    settingsChangePasswordBtn: document.getElementById('settingsChangePasswordBtn'),
    svThresholdSuccess: document.getElementById('svThresholdSuccess'),
    svThresholdWarning: document.getElementById('svThresholdWarning'),
    svThresholdDanger: document.getElementById('svThresholdDanger'),
    svSaveThresholds: document.getElementById('svSaveThresholds'),
    settingsDbPath: document.getElementById('settingsDbPath'),
    settingsSwitchDbBtn: document.getElementById('settingsSwitchDbBtn'),
    settingsUserMgmtBtn: document.getElementById('settingsUserMgmtBtn'),
    settingsAuditLogBtn: document.getElementById('settingsAuditLogBtn'),
    settingsAuditCard: document.getElementById('settingsAuditCard'),
    settingsFactoryResetBtn: document.getElementById('settingsFactoryResetBtn'),
    svDashboardTopLimit: document.getElementById('svDashboardTopLimit'),
    svDashboardRecentLimit: document.getElementById('svDashboardRecentLimit'),
    svDashboardCriticalLimit: document.getElementById('svDashboardCriticalLimit'),
    svBackupRetentionDays: document.getElementById('svBackupRetentionDays'),
    svSaveLimits: document.getElementById('svSaveLimits'),
    backupListContainer: document.getElementById('backupListContainer'),
    createBackupBtn: document.getElementById('createBackupBtn'),
    appInfoVersion: document.getElementById('appInfoVersion'),
    appInfoBewertungen: document.getElementById('appInfoBewertungen'),
    appInfoLieferanten: document.getElementById('appInfoLieferanten'),
    appInfoFragen: document.getElementById('appInfoFragen'),
    appInfoUsers: document.getElementById('appInfoUsers'),
    appInfoDbSize: document.getElementById('appInfoDbSize'),
    appInfoOs: document.getElementById('appInfoOs'),

    // Welcome Modal (Ersteinrichtung)
    welcomeModal: document.getElementById('welcomeModal'),
    welcomeDbPath: document.getElementById('welcomeDbPath'),
    selectDbPath: document.getElementById('selectDbPath'),
    welcomeUseDefault: document.getElementById('welcomeUseDefault'),
    welcomeConfirm: document.getElementById('welcomeConfirm'),

    // Login Modal
    loginModal: document.getElementById('loginModal'),
    loginModalTitle: document.getElementById('loginModalTitle'),
    loginUsername: document.getElementById('loginUsername'),
    loginPassword: document.getElementById('loginPassword'),
    loginError: document.getElementById('loginError'),
    cancelLogin: document.getElementById('cancelLogin'),
    confirmLogin: document.getElementById('confirmLogin'),
    loginToggle: document.getElementById('loginToggle'),
    loginStatus: document.getElementById('loginStatus'),
    loginDropdownWrapper: document.getElementById('loginDropdownWrapper'),
    loginDropdown: document.getElementById('loginDropdown'),
    loginSwitchDb: document.getElementById('loginSwitchDb'),

    // Password Modal
    passwordModal: document.getElementById('passwordModal'),
    oldPassword: document.getElementById('oldPassword'),
    newPassword: document.getElementById('newPassword'),
    confirmPassword: document.getElementById('confirmPassword'),
    passwordError: document.getElementById('passwordError'),
    cancelPassword: document.getElementById('cancelPassword'),
    confirmPasswordChange: document.getElementById('confirmPasswordChange'),

    // SE-Team Modal
    seTeamModal: document.getElementById('seTeamModal'),
    newSeTeamInput: document.getElementById('newSeTeamInput'),
    seTeamListContainer: document.getElementById('seTeamList'),
    cancelSeTeam: document.getElementById('cancelSeTeam'),
    confirmSeTeam: document.getElementById('confirmSeTeam'),

    // Frage Modal (Admin)
    frageModal: document.getElementById('frageModal'),
    frageModalTitle: document.getElementById('frageModalTitle'),
    frageGruppe: document.getElementById('frageGruppe'),
    frageGruppeInput: document.getElementById('frageGruppeInput'),
    frageGruppeWrapper: document.getElementById('frageGruppeWrapper'),
    frageGruppeDropdown: document.getElementById('frageGruppeDropdown'),
    frageText: document.getElementById('frageText'),
    fragePosition: document.getElementById('fragePosition'),
    cancelFrage: document.getElementById('cancelFrage'),
    confirmFrage: document.getElementById('confirmFrage'),

    // Edit Frage Modal (Admin)
    editFrageModal: document.getElementById('editFrageModal'),
    editFrageText: document.getElementById('editFrageText'),
    editFrageGewichtung: document.getElementById('editFrageGewichtung'),
    deleteFrage: document.getElementById('deleteFrage'),
    cancelEditFrage: document.getElementById('cancelEditFrage'),
    confirmEditFrage: document.getElementById('confirmEditFrage'),

    // User Management Modal (Admin)
    userManagementModal: document.getElementById('userManagementModal'),
    userManagementBtn: document.getElementById('settingsUserMgmtBtn'),
    userList: document.getElementById('userList'),
    addUserBtn: document.getElementById('addUserBtn'),
    closeUserManagement: document.getElementById('closeUserManagement'),

    // New User Modal
    newUserModal: document.getElementById('newUserModal'),
    newUsername: document.getElementById('newUsername'),
    newUserPassword: document.getElementById('newUserPassword'),
    newUserRole: document.getElementById('newUserRole'),
    cancelNewUser: document.getElementById('cancelNewUser'),
    confirmNewUser: document.getElementById('confirmNewUser'),

    // Edit User Modal
    editUsername: document.getElementById('editUsername'),
    editUserRole: document.getElementById('editUserRole'),
    editUserRoleInput: document.getElementById('editUserRoleInput'),
    editUserRoleWrapper: document.getElementById('editUserRoleWrapper'),
    editUserRoleDropdown: document.getElementById('editUserRoleDropdown'),
    editUserActive: document.getElementById('editUserActive'),
    editUserActiveInput: document.getElementById('editUserActiveInput'),
    editUserActiveWrapper: document.getElementById('editUserActiveWrapper'),
    editUserActiveDropdown: document.getElementById('editUserActiveDropdown'),
    // New User Role (Custom Dropdown)
    newUserRoleInput: document.getElementById('newUserRoleInput'),
    newUserRoleWrapper: document.getElementById('newUserRoleWrapper'),
    newUserRoleDropdown: document.getElementById('newUserRoleDropdown'),
    editUserNewPassword: document.getElementById('editUserNewPassword'),
    deleteUserBtn: document.getElementById('deleteUserBtn'),
    cancelEditUser: document.getElementById('cancelEditUser'),
    confirmEditUser: document.getElementById('confirmEditUser'),

    // Audit Log Modal
    auditLogModal: document.getElementById('auditLogModal'),
    auditLogBtn: document.getElementById('settingsAuditLogBtn'),
    auditLogList: document.getElementById('auditLogList'),
    closeAuditLog: document.getElementById('closeAuditLog'),

    // Status
    statusMessage: document.getElementById('statusMessage'),
    statusDb: document.getElementById('statusDb'),

    // Theme
    themeToggle: document.getElementById('themeToggle'),

    // PDF Modal
    pdfModal: document.getElementById('pdfModal'),
    pdfPreview: document.getElementById('pdfPreview'),
    pdfDatum: document.getElementById('pdfDatum'),
    pdfBerichtNr: document.getElementById('pdfBerichtNr'),
    pdfLieferant: document.getElementById('pdfLieferant'),
    pdfSeTeam: document.getElementById('pdfSeTeam'),
    pdfErgebnis: document.getElementById('pdfErgebnis'),
    pdfChart: document.getElementById('pdfChart'),
    pdfChartLegend: document.getElementById('pdfChartLegend'),
    pdfDetailsTable: document.getElementById('pdfDetailsTable'),
    pdfCommentsSection: document.getElementById('pdfCommentsSection'),
    pdfComments: document.getElementById('pdfComments'),
    pdfMassnahmenSection: document.getElementById('pdfMassnahmenSection'),
    pdfMassnahmen: document.getElementById('pdfMassnahmen'),
    pdfBestellnummer: document.getElementById('pdfBestellnummer'),
    pdfFooterDate: document.getElementById('pdfFooterDate'),
    cancelPdf: document.getElementById('cancelPdf'),
    downloadPdf: document.getElementById('downloadPdf'),

    // Historie View Toggle
    viewToggleBtns: document.querySelectorAll('.view-toggle-btn'),
    viewToggleWrapper: document.querySelector('.view-toggle-wrapper'),
    viewToggleDropdownBtn: document.getElementById('viewToggleDropdownBtn'),
    historieTableView: document.getElementById('historieTableView'),
    historieTimelineView: document.getElementById('historieTimelineView'),
    historieTrendsView: document.getElementById('historieTrendsView'),
    historieCompareView: document.getElementById('historieCompareView'),
    historieAuditView: document.getElementById('historieAuditView'),

    // Timeline View
    timelineContainer: document.getElementById('timelineContainer'),
    timelineEmpty: document.getElementById('timelineEmpty'),

    // Trends View
    trendLieferantWrapper: document.getElementById('trendLieferantWrapper'),
    trendLieferantInput: document.getElementById('trendLieferantInput'),
    trendLieferantFilter: document.getElementById('trendLieferantFilter'),
    trendLieferantDropdown: document.getElementById('trendLieferantDropdown'),
    trendLineChart: document.getElementById('trendLineChart'),
    trendBarChart: document.getElementById('trendBarChart'),
    trendsStats: document.getElementById('trendsStats'),
    trendsEmpty: document.getElementById('trendsEmpty'),

    // Compare View
    compare1Wrapper: document.getElementById('compare1Wrapper'),
    compare1Input: document.getElementById('compare1Input'),
    compare1Filter: document.getElementById('compare1Filter'),
    compare1Dropdown: document.getElementById('compare1Dropdown'),
    compare2Wrapper: document.getElementById('compare2Wrapper'),
    compare2Input: document.getElementById('compare2Input'),
    compare2Filter: document.getElementById('compare2Filter'),
    compare2Dropdown: document.getElementById('compare2Dropdown'),
    compareContent: document.getElementById('compareContent'),
    compareTitle1: document.getElementById('compareTitle1'),
    compareScore1: document.getElementById('compareScore1'),
    compareBody1: document.getElementById('compareBody1'),
    compareTitle2: document.getElementById('compareTitle2'),
    compareScore2: document.getElementById('compareScore2'),
    compareBody2: document.getElementById('compareBody2'),
    compareRadarChart: document.getElementById('compareRadarChart'),
    compareEmpty: document.getElementById('compareEmpty'),

    // Audit View
    auditTableBody: document.getElementById('auditTableBody'),
    auditEmpty: document.getElementById('auditEmpty'),
    auditModalSearch: document.getElementById('auditModalSearch'),
    auditModalCount: document.getElementById('auditModalCount'),
    auditTableSearch: document.getElementById('auditTableSearch'),
    auditTableCount: document.getElementById('auditTableCount'),

    // Phase 6: Ziele & Sollwerte
    settingsZieleBtn: document.getElementById('settingsZieleBtn'),
    dashboardZieleWidget: document.getElementById('dashboardZieleWidget'),
    zieleSummaryBar: document.getElementById('zieleSummaryBar'),
    zieleDetailsList: document.getElementById('zieleDetailsList'),
    // Ziele Management Modal
    zieleManagementModal: document.getElementById('zieleManagementModal'),
    zieleFilterQuartal: document.getElementById('zieleFilterQuartal'),
    zieleFilterQuartalInput: document.getElementById('zieleFilterQuartalInput'),
    zieleFilterQuartalWrapper: document.getElementById('zieleFilterQuartalWrapper'),
    zieleFilterQuartalDropdown: document.getElementById('zieleFilterQuartalDropdown'),
    addNewZielBtn: document.getElementById('addNewZielBtn'),
    zieleListContainer: document.getElementById('zieleListContainer'),
    closeZieleManagement: document.getElementById('closeZieleManagement'),
    // Ziel Form Modal
    zielFormModal: document.getElementById('zielFormModal'),
    zielFormTitle: document.getElementById('zielFormTitle'),
    zielLieferantSelect: document.getElementById('zielLieferantSelect'),
    zielLieferantInput: document.getElementById('zielLieferantInput'),
    zielLieferantWrapper: document.getElementById('zielLieferantWrapper'),
    zielLieferantDropdown: document.getElementById('zielLieferantDropdown'),
    zielQuartalSelect: document.getElementById('zielQuartalSelect'),
    zielQuartalInput: document.getElementById('zielQuartalInput'),
    zielQuartalWrapper: document.getElementById('zielQuartalWrapper'),
    zielQuartalDropdown: document.getElementById('zielQuartalDropdown'),
    zielWertInput: document.getElementById('zielWertInput'),
    zielBeschreibungInput: document.getElementById('zielBeschreibungInput'),
    cancelZielForm: document.getElementById('cancelZielForm'),
    confirmZielForm: document.getElementById('confirmZielForm')
};

// ============================================================================
// Initialize
// ============================================================================
let selectedDbPath = null; // Temp storage for selected DB path

async function init() {
    // Load theme (vor allem für Splash-Screen Hintergrundfarbe)
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Restore sidebar state
    const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    const sidebar = document.getElementById('sidebar');
    if (sidebarCollapsed && sidebar) sidebar.classList.add('collapsed');

    try {
        // Check if first launch
        const isFirstLaunch = await invoke('is_first_launch');
        if (isFirstLaunch) {
            dismissSplash();
            await showWelcomeModal();
            return; // Wait for user to complete setup
        }
    } catch (e) {
        console.error('Error checking first launch:', e);
        // Continue with normal init even if check fails
    }

    // Init und Mindest-Splash-Dauer parallel abwarten
    const splashMinTime = new Promise(resolve => setTimeout(resolve, 2200));
    await Promise.all([initApp(), splashMinTime]);

    // Splash ausblenden und Login-Dialog öffnen
    dismissSplash(() => {
        if (!state.currentUser) {
            elements.loginUsername.value = '';
            elements.loginPassword.value = '';
            elements.loginError.textContent = '';
            showModal('loginModal');
        }
    });
}

function dismissSplash(callback) {
    const splash = document.getElementById('splashScreen');
    if (!splash) {
        if (callback) callback();
        return;
    }
    splash.classList.add('fade-out');
    setTimeout(() => {
        splash.remove();
        if (callback) callback();
    }, 500);
}

async function initApp() {
    // Alle unabhängigen Daten parallel laden für schnelleren Start
    await Promise.all([
        loadPdfLogo(),
        loadLieferanten(),
        loadSeTeams(),
        loadFragen(),
        loadGruppen(),
        loadDatum(),
        loadDbPath(),
        loadSettings(),
    ]);

    // Check changelog
    checkChangelog();

    // Setup event listeners
    setupEventListeners();
    initPasswordToggles();
    initCrossDbEvents();
    setupCsvImport();

    // Batch PDF Button
    const batchPdfBtn = document.getElementById('batchPdfBtn');
    if (batchPdfBtn) batchPdfBtn.addEventListener('click', generateBatchPdf);

    // Render questions
    renderQuestions();
    updateProgress();

    // Render Historie filter dropdowns (Jahr and Quartal are static)
    renderHistorieJahrDropdown();
    renderHistorieQuartalDropdown();

    // Set default filters to current quarter/year
    setDefaultHistorieFilters();

    // Load Dashboard timeframe from localStorage
    loadDashboardTimeframe();

    // Load Dashboard (initial view)
    loadDashboard();
}

// Set default Historie filters to current quarter and year
function setDefaultHistorieFilters() {
    const now = new Date();
    const currentYear = now.getFullYear().toString();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentQuartal = Math.ceil(currentMonth / 3).toString();

    // Set Jahr filter
    elements.historieJahrFilter.value = currentYear;
    elements.historieJahrFilterInput.value = currentYear;

    // Set Quartal filter
    elements.historieQuartalFilter.value = currentQuartal;
    elements.historieQuartalFilterInput.value = 'Q' + currentQuartal;
}

// ============================================================================
// Welcome Modal (Ersteinrichtung)
// ============================================================================
async function showWelcomeModal() {
    try {
        const defaultPath = await invoke('get_default_db_path');
        selectedDbPath = defaultPath;
        elements.welcomeDbPath.textContent = defaultPath;
        elements.welcomeConfirm.disabled = false;
    } catch (e) {
        console.error('Error getting default DB path:', e);
        elements.welcomeDbPath.textContent = 'Fehler beim Laden des Standardpfads';
        elements.welcomeConfirm.disabled = true;
    }

    // Show modal
    elements.welcomeModal.classList.add('visible');

    // Setup welcome modal event listeners (nur einmal)
    setupWelcomeEventListeners();
}

let _welcomeListenersAttached = false;
function setupWelcomeEventListeners() {
    if (_welcomeListenersAttached) return;
    _welcomeListenersAttached = true;

    // Select DB path button
    elements.selectDbPath.addEventListener('click', async () => {
        try {
            const path = await invoke('select_db_location');
            if (path) {
                selectedDbPath = path;
                elements.welcomeDbPath.textContent = path;
                elements.welcomeConfirm.disabled = false;
            }
        } catch (e) {
            console.error('Error selecting path:', e);
        }
    });

    // Use default button
    elements.welcomeUseDefault.addEventListener('click', async () => {
        try {
            const defaultPath = await invoke('get_default_db_path');
            selectedDbPath = defaultPath;
            elements.welcomeDbPath.textContent = defaultPath;
            elements.welcomeConfirm.disabled = false;
        } catch (e) {
            console.error('Error getting default path:', e);
            showStatus('Fehler beim Laden des Standardpfads: ' + e, true);
        }
    });

    // Confirm button
    elements.welcomeConfirm.addEventListener('click', async () => {
        if (!selectedDbPath) return;

        try {
            // Save the selected path to config
            await invoke('set_db_path', { path: selectedDbPath });

            // Switch database connection to the selected path
            await invoke('switch_database', { path: selectedDbPath });

            // Hide welcome modal
            elements.welcomeModal.classList.remove('visible');

            // Continue with app initialization
            await initApp();
        } catch (e) {
            console.error('Error saving config:', e);
            showStatus('Fehler beim Speichern der Konfiguration: ' + e, true);
        }
    });
}

async function loadLieferanten() {
    try {
        state.lieferanten = await invoke('get_lieferanten');
        // Filter out empty names and sort alphabetically (case-insensitive)
        state.lieferanten = state.lieferanten.filter(l => l && l.name && l.name.trim() !== '');
        state.lieferanten.sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
        renderLieferantenSelect();
    } catch (e) {
        // Vor Login erwarteter Fehler — nur loggen wenn eingeloggt
        if (state.currentUser) showStatus('Fehler beim Laden der Lieferanten: ' + e, true);
    }
}

async function loadSeTeams() {
    try {
        state.seTeams = await invoke('get_se_teams');
        // Filter out empty names and sort alphabetically (case-insensitive)
        state.seTeams = state.seTeams.filter(t => t && t.name && t.name.trim() !== '');
        state.seTeams.sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
        renderSeTeamList();
    } catch (e) {
        if (state.currentUser) showStatus('Fehler beim Laden der SE-Teams: ' + e, true);
    }
}

// Helper: Lieferant-ID aus Name auflösen
function getLieferantIdByName(name) {
    const obj = state.lieferanten.find(l => l.name === name);
    return obj ? obj.id : null;
}

// Helper: SE-Team-ID aus Name auflösen
function getSeTeamIdByName(name) {
    const obj = state.seTeams.find(t => t.name === name);
    return obj ? obj.id : null;
}

// Helper: Lieferant-Name aus ID auflösen
function getLieferantNameById(id) {
    const obj = state.lieferanten.find(l => l.id === id);
    return obj ? obj.name : '';
}

async function loadFragen() {
    try {
        state.fragen = await invoke('get_fragen_cmd');
        // Initialize antworten for new questions (ID-based)
        state.fragen.forEach(f => {
            if (state.antworten[f.id] === undefined) {
                state.antworten[f.id] = -1; // Unbeantwortet
            }
        });
        // Remove answers for deleted questions
        const validIds = new Set(state.fragen.map(f => f.id));
        Object.keys(state.antworten).forEach(id => {
            if (!validIds.has(parseInt(id))) {
                delete state.antworten[id];
            }
        });
    } catch (e) {
        if (state.currentUser) showStatus('Fehler beim Laden der Fragen: ' + e, true);
    }
}

async function loadGruppen() {
    try {
        state.gruppen = await invoke('get_gruppen_cmd');
    } catch (e) {
        console.error('Fehler beim Laden der Gruppen: ' + e);
    }
}

async function loadDatum() {
    try {
        const heute = await invoke('get_heute');
        state.selectedDate = parseDate(heute);
        state.datePickerMonth = new Date(state.selectedDate);
        updateDateDisplay();
    } catch (e) {
        state.selectedDate = new Date();
        state.datePickerMonth = new Date();
        updateDateDisplay();
    }
}

async function loadDbPath() {
    try {
        const path = await invoke('get_current_db_path');
        elements.statusDb.textContent = 'DB: ' + path;
    } catch (e) {
        // Fallback to static path
        try {
            const path = await invoke('get_db_path');
            elements.statusDb.textContent = 'DB: ' + path;
        } catch (e2) {
            elements.statusDb.textContent = '';
        }
    }
}

async function loadSettings() {
    try {
        const settings = await invoke('get_settings_cmd');
        state.settings = settings;
    } catch (e) {
        console.error('Error loading settings:', e);
        // Use defaults
        state.settings = {
            threshold_success: 75.0,
            threshold_warning: 50.0
        };
    }
}

// ============================================================================
// Dashboard
// ============================================================================

// Load dashboard timeframe from localStorage
function loadDashboardTimeframe() {
    const saved = localStorage.getItem('dashboardTimeframe');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            state.dashboardTimeframe = parsed.timeframe || 'quarter';
            state.dashboardCustomStart = parsed.customStart || null;
            state.dashboardCustomEnd = parsed.customEnd || null;
        } catch (e) {
            state.dashboardTimeframe = 'quarter';
        }
    }
    updateTimeframeLabel();
}

// Save dashboard timeframe to localStorage
function saveDashboardTimeframe() {
    localStorage.setItem('dashboardTimeframe', JSON.stringify({
        timeframe: state.dashboardTimeframe,
        customStart: state.dashboardCustomStart,
        customEnd: state.dashboardCustomEnd
    }));
}

// Update the timeframe label in the button
function updateTimeframeLabel() {
    const labels = {
        'today': 'Heute',
        'week': 'Diese Woche',
        'month': 'Dieser Monat',
        'quarter': 'Dieses Quartal',
        'year': 'Dieses Jahr',
        'last_quarter': 'Letztes Quartal',
        'last_year': 'Letztes Jahr',
        'custom': 'Benutzerdefiniert'
    };

    let label = labels[state.dashboardTimeframe] || 'Dieses Quartal';

    // For custom, show the date range
    if (state.dashboardTimeframe === 'custom' && state.dashboardCustomStart && state.dashboardCustomEnd) {
        const start = formatDate(state.dashboardCustomStart);
        const end = formatDate(state.dashboardCustomEnd);
        label = `${start} - ${end}`;
    }

    if (elements.dashboardTimeframeLabel) {
        elements.dashboardTimeframeLabel.textContent = label;
    }

    // Update active state in dropdown
    if (elements.dashboardTimeframeDropdown) {
        elements.dashboardTimeframeDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
            item.classList.toggle('active', item.dataset.value === state.dashboardTimeframe);
        });
    }
}

// Handle timeframe selection
function selectDashboardTimeframe(timeframe) {
    if (timeframe === 'custom') {
        // Open date range modal
        openDateRangeModal();
        return;
    }

    state.dashboardTimeframe = timeframe;
    state.dashboardCustomStart = null;
    state.dashboardCustomEnd = null;
    saveDashboardTimeframe();
    updateTimeframeLabel();
    closeDashboardTimeframeDropdown();
    loadDashboard();
}

// Open/close timeframe dropdown
function toggleDashboardTimeframeDropdown() {
    const isOpen = elements.dashboardTimeframeDropdown.classList.contains('visible');
    if (isOpen) {
        closeDashboardTimeframeDropdown();
    } else {
        elements.dashboardTimeframeDropdown.classList.add('visible');
        elements.dashboardTimeframeWrapper.classList.add('open');
    }
}

function closeDashboardTimeframeDropdown() {
    elements.dashboardTimeframeDropdown.classList.remove('visible');
    elements.dashboardTimeframeWrapper.classList.remove('open');
}

// Date Range Modal
function openDateRangeModal() {
    closeDashboardTimeframeDropdown();

    // Set default dates (last 30 days if no custom range set)
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Initialize dates
    if (state.dashboardCustomStart) {
        state.dateRangeStartDate = parseDate(state.dashboardCustomStart);
    } else {
        state.dateRangeStartDate = thirtyDaysAgo;
    }

    if (state.dashboardCustomEnd) {
        state.dateRangeEndDate = parseDate(state.dashboardCustomEnd);
    } else {
        state.dateRangeEndDate = now;
    }

    // Set hidden values
    elements.dateRangeStart.value = formatDateISO(state.dateRangeStartDate);
    elements.dateRangeEnd.value = formatDateISO(state.dateRangeEndDate);

    // Set display values
    elements.dateRangeStartInput.value = formatDateDisplay(state.dateRangeStartDate);
    elements.dateRangeEndInput.value = formatDateDisplay(state.dateRangeEndDate);

    // Initialize calendar months
    state.dateRangeStartMonth = new Date(state.dateRangeStartDate);
    state.dateRangeEndMonth = new Date(state.dateRangeEndDate);

    // Render calendars
    renderDateRangePicker('start');
    renderDateRangePicker('end');

    showModal('dateRangeModal');
}

function renderDateRangePicker(type) {
    const month = type === 'start' ? state.dateRangeStartMonth : state.dateRangeEndMonth;
    const titleEl = type === 'start' ? elements.dateRangeStartTitle : elements.dateRangeEndTitle;
    const daysEl = type === 'start' ? elements.dateRangeStartDays : elements.dateRangeEndDays;
    const selectedDate = type === 'start' ? state.dateRangeStartDate : state.dateRangeEndDate;

    const year = month.getFullYear();
    const monthNum = month.getMonth();

    titleEl.textContent = `${MONTH_NAMES[monthNum]} ${year}`;

    const firstDay = new Date(year, monthNum, 1);
    const lastDay = new Date(year, monthNum + 1, 0);
    const startDay = (firstDay.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = lastDay.getDate();

    const today = new Date();
    const selectedISO = selectedDate ? formatDateISO(selectedDate) : '';

    let html = '';

    // Previous month days
    const prevMonth = new Date(year, monthNum, 0);
    const prevDays = prevMonth.getDate();
    for (let i = startDay - 1; i >= 0; i--) {
        const day = prevDays - i;
        const dateISO = formatDateISO(new Date(year, monthNum - 1, day));
        html += `<div class="date-picker-day other-month" data-date="${dateISO}" data-type="${type}">${day}</div>`;
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, monthNum, day);
        const dateISO = formatDateISO(date);
        const isToday = date.toDateString() === today.toDateString();
        const isSelected = dateISO === selectedISO;
        let classes = 'date-picker-day';
        if (isToday) classes += ' today';
        if (isSelected) classes += ' selected';
        html += `<div class="${classes}" data-date="${dateISO}" data-type="${type}">${day}</div>`;
    }

    // Next month days
    const totalCells = startDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let day = 1; day <= remaining; day++) {
        const dateISO = formatDateISO(new Date(year, monthNum + 1, day));
        html += `<div class="date-picker-day other-month" data-date="${dateISO}" data-type="${type}">${day}</div>`;
    }

    daysEl.innerHTML = html;

    // Add click handlers to days
    daysEl.querySelectorAll('.date-picker-day').forEach(dayEl => {
        dayEl.addEventListener('click', (e) => {
            e.stopPropagation();
            selectDateRangeDay(dayEl.dataset.date, dayEl.dataset.type);
        });
    });
}

function selectDateRangeDay(dateISO, type) {
    const date = parseDate(dateISO);

    if (type === 'start') {
        state.dateRangeStartDate = date;
        elements.dateRangeStart.value = dateISO;
        elements.dateRangeStartInput.value = formatDateDisplay(date);
        elements.dateRangeStartDropdown.classList.remove('visible');
    } else {
        state.dateRangeEndDate = date;
        elements.dateRangeEnd.value = dateISO;
        elements.dateRangeEndInput.value = formatDateDisplay(date);
        elements.dateRangeEndDropdown.classList.remove('visible');
    }

    renderDateRangePicker(type);
}

function changeDateRangeMonth(type, delta) {
    if (type === 'start') {
        state.dateRangeStartMonth.setMonth(state.dateRangeStartMonth.getMonth() + delta);
    } else {
        state.dateRangeEndMonth.setMonth(state.dateRangeEndMonth.getMonth() + delta);
    }
    renderDateRangePicker(type);
}

function toggleDateRangeDropdown(type, e) {
    if (e) e.stopPropagation();
    const dropdown = type === 'start' ? elements.dateRangeStartDropdown : elements.dateRangeEndDropdown;
    const otherDropdown = type === 'start' ? elements.dateRangeEndDropdown : elements.dateRangeStartDropdown;

    // Close the other dropdown
    otherDropdown.classList.remove('visible');

    // Toggle this dropdown
    const isVisible = dropdown.classList.toggle('visible');
    if (isVisible) {
        renderDateRangePicker(type);
    }
}

function applyCustomDateRange() {
    const start = elements.dateRangeStart.value;
    const end = elements.dateRangeEnd.value;

    if (!start || !end) {
        showStatus('Bitte Start- und Enddatum angeben', true);
        return;
    }

    if (start > end) {
        showStatus('Startdatum muss vor Enddatum liegen', true);
        return;
    }

    state.dashboardTimeframe = 'custom';
    state.dashboardCustomStart = start;
    state.dashboardCustomEnd = end;
    saveDashboardTimeframe();
    updateTimeframeLabel();
    hideModal('dateRangeModal');
    loadDashboard();
}

async function loadDashboard() {
    // Nicht laden wenn kein User eingeloggt ist
    if (!state.currentUser) return;

    // Race condition protection
    if (state.isLoadingDashboard) return;
    state.isLoadingDashboard = true;
    updateDashboardRefreshState(true);

    try {
        // Build timeframe parameter
        let timeframeParam = state.dashboardTimeframe;
        let customStart = null;
        let customEnd = null;

        if (state.dashboardTimeframe === 'custom') {
            customStart = state.dashboardCustomStart;
            customEnd = state.dashboardCustomEnd;
        }

        const data = await invoke('get_dashboard_data_cmd', {
            timeframe: timeframeParam,
            customStart: customStart,
            customEnd: customEnd
        });
        await renderDashboard(data);
    } catch (e) {
        console.error('Error loading dashboard:', e);
        // "Nicht angemeldet"-Fehler still ignorieren (erwarteter Zustand beim Start)
        const msg = String(e);
        if (msg.includes('Nicht angemeldet') || msg.includes('nicht angemeldet')) return;
        showStatus('Fehler beim Laden des Dashboards: ' + e, true);
    } finally {
        state.isLoadingDashboard = false;
        updateDashboardRefreshState(false);
    }
}

function updateDashboardRefreshState(isLoading) {
    if (!elements.dashboardRefreshBtn) return;

    if (isLoading) {
        elements.dashboardRefreshBtn.classList.add('loading');
        elements.dashboardRefreshBtn.setAttribute('disabled', 'disabled');
    } else {
        elements.dashboardRefreshBtn.classList.remove('loading');
        elements.dashboardRefreshBtn.removeAttribute('disabled');
    }
}

async function renderDashboard(data) {
    // Store data for detail modals
    state.dashboardData = data;

    // KPI Cards
    elements.dashboardQuartalLabel.textContent = data.aktuelles_quartal;
    elements.dashboardBewertungenQuartal.textContent = data.bewertungen_quartal;
    elements.dashboardLieferanten.textContent = data.lieferanten_gesamt;

    if (data.durchschnitt_quartal !== null) {
        const avg = data.durchschnitt_quartal;
        elements.dashboardDurchschnitt.textContent = avg.toFixed(1) + '%';
        elements.dashboardDurchschnitt.className = 'kpi-value ' + getResultClass(avg);
    } else {
        elements.dashboardDurchschnitt.textContent = '--%';
        elements.dashboardDurchschnitt.className = 'kpi-value';
    }

    elements.dashboardKritische.textContent = (data.kritische_lieferanten || []).length;

    // Bewertungsfortschritt Widget
    if (elements.dashboardProgressWidget && data.lieferanten_gesamt > 0) {
        const bewertet = data.lieferanten_gesamt - (data.fehlende_bewertungen || []).length;
        const gesamt = data.lieferanten_gesamt;
        const prozent = Math.round((bewertet / gesamt) * 100);
        elements.dashboardProgressWidget.style.display = 'flex';
        elements.progressQuartalLabel.textContent = data.aktuelles_quartal;
        elements.progressWidgetCount.textContent = `${bewertet} / ${gesamt} Lieferanten`;
        elements.progressWidgetFill.style.width = prozent + '%';
        elements.progressWidgetPercent.textContent = prozent + '% abgeschlossen';
        // Color: green when >=80%, accent when >=50%, warning otherwise
        if (prozent >= 80) {
            elements.progressWidgetFill.style.background = 'linear-gradient(90deg, #22c55e, #16a34a)';
        } else if (prozent >= 50) {
            elements.progressWidgetFill.style.background = 'linear-gradient(90deg, var(--accent), #22c55e)';
        } else {
            elements.progressWidgetFill.style.background = 'linear-gradient(90deg, #f59e0b, var(--accent))';
        }
    } else if (elements.dashboardProgressWidget) {
        elements.dashboardProgressWidget.style.display = 'none';
    }

    // Missing Evaluations Banner
    if (data.fehlende_bewertungen && data.fehlende_bewertungen.length > 0) {
        elements.dashboardMissingBanner.style.display = 'flex';
        elements.missingQuartalLabel.textContent = data.aktuelles_quartal;
        elements.missingBannerList.innerHTML = data.fehlende_bewertungen.map(name =>
            `<span class="missing-banner-item" data-lieferant="${escapeHtml(name)}">${escapeHtml(name)}</span>`
        ).join('');
        // Event-Listener via Event-Delegation in setupEventListeners()
    } else {
        elements.dashboardMissingBanner.style.display = 'none';
    }

    // Top Performer (beste Lieferanten)
    if (data.top_performer && data.top_performer.length > 0) {
        elements.dashboardTopPerformer.innerHTML = data.top_performer.map(l => {
            return `
                <div class="top-performer-item" data-lieferant="${escapeHtml(l.name)}">
                    <span class="top-performer-rank">#${l.rang}</span>
                    <span class="top-performer-name">${escapeHtml(l.name)}</span>
                    <span class="top-performer-score success">${l.durchschnitt.toFixed(1)}%</span>
                </div>
            `;
        }).join('');
        // Event-Listener via Event-Delegation in setupEventListeners()
    } else {
        elements.dashboardTopPerformer.innerHTML = `
            <div class="dashboard-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
                </svg>
                <p>Keine Bewertungen vorhanden</p>
            </div>
        `;
    }

    // Letzte Bewertungen
    if (data.letzte_bewertungen && data.letzte_bewertungen.length > 0) {
        elements.dashboardLetzteBewertungen.innerHTML = data.letzte_bewertungen.map(h => {
            const scoreClass = getResultClass(h.ergebnis);
            return `
                <div class="letzte-item" data-id="${h.id}">
                    <span class="letzte-item-id">SEVALSystem-${h.id}</span>
                    <span class="letzte-item-name">${escapeHtml(h.lieferant)}</span>
                    <span class="letzte-item-score ${scoreClass}">${h.ergebnis.toFixed(1)}%</span>
                    <span class="letzte-item-date">${formatDate(h.datum)}</span>
                </div>
            `;
        }).join('');
        // Event-Listener via Event-Delegation in setupEventListeners()
    } else {
        elements.dashboardLetzteBewertungen.innerHTML = `
            <div class="dashboard-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
                    <rect x="9" y="3" width="6" height="4" rx="1"/>
                </svg>
                <p>Keine Bewertungen vorhanden</p>
            </div>
        `;
    }

    // Offene Maßnahmen — strukturiert (Phase 2) + Legacy-Freitext
    await renderDashboardMassnahmen(data);

    // Bewertungsverteilung (Donut Chart)
    renderDashboardDonutChart(data.bewertungsverteilung);

    // Ziele & Sollwerte Widget (Phase 6)
    renderDashboardZiele(data);
}

async function renderDashboardMassnahmen(data) {
    if (!elements.dashboardOffeneMassnahmen) return;

    // Strukturierte Maßnahmen laden (Phase 2)
    let strukturiert = [];
    try {
        strukturiert = await invoke('get_offene_massnahmen_cmd', { lieferantId: null, seTeamId: null });
    } catch (e) {
        console.warn('Fehler beim Laden strukturierter Maßnahmen:', e);
    }

    if (strukturiert.length > 0) {
        // Übersicht-Header
        let ueberfaellig = strukturiert.filter(m => m.status === 'ueberfaellig').length;
        let headerHtml = '';
        if (ueberfaellig > 0) {
            headerHtml = `<div class="massnahmen-dashboard-header"><span class="massnahme-status-badge ueberfaellig">${ueberfaellig} überfällig</span> <span style="color:var(--text-secondary);font-size:0.8rem;">${strukturiert.length} offen gesamt</span></div>`;
        }

        elements.dashboardOffeneMassnahmen.innerHTML = headerHtml + strukturiert.slice(0, 8).map(m => {
            const statusCls = m.status || 'offen';
            const faelligHtml = m.faellig_am ? `<span class="massnahme-date-tag${statusCls === 'ueberfaellig' ? ' overdue' : ''}">${formatDate(m.faellig_am)}</span>` : '';
            const verantwHtml = m.verantwortlich ? `<span class="massnahme-verantw-tag">${escapeHtml(m.verantwortlich)}</span>` : '';
            return `
                <div class="reminder-item" data-id="${m.bewertung_id}">
                    <div class="reminder-icon">
                        <span class="massnahme-status-badge ${statusCls}">${statusCls === 'ueberfaellig' ? '!' : statusCls === 'in_bearbeitung' ? '◐' : '○'}</span>
                    </div>
                    <div class="reminder-content">
                        <div class="reminder-header">
                            <span class="reminder-supplier">${escapeHtml(m.lieferant || '')}</span>
                            <span style="display:flex;gap:4px;align-items:center;">${verantwHtml}${faelligHtml}</span>
                        </div>
                        <div class="reminder-text">${escapeHtml(m.beschreibung.length > 80 ? m.beschreibung.substring(0, 80) + '...' : m.beschreibung)}</div>
                    </div>
                </div>
            `;
        }).join('');
    } else if (data.offene_massnahmen && data.offene_massnahmen.length > 0) {
        // Fallback: Legacy-Freitext-Maßnahmen
        elements.dashboardOffeneMassnahmen.innerHTML = data.offene_massnahmen.map(m => {
            const kurzText = m.massnahmen.length > 100 ? m.massnahmen.substring(0, 100) + '...' : m.massnahmen;
            return `
                <div class="reminder-item" data-id="${m.bewertung_id}">
                    <div class="reminder-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                    </div>
                    <div class="reminder-content">
                        <div class="reminder-header">
                            <span class="reminder-supplier">${escapeHtml(m.lieferant)}</span>
                            <span class="reminder-date">${formatDate(m.datum)}</span>
                        </div>
                        <div class="reminder-text">${escapeHtml(kurzText)}</div>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        elements.dashboardOffeneMassnahmen.innerHTML = `
            <div class="dashboard-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <polyline points="20,6 9,17 4,12"/>
                </svg>
                <p>Keine offenen Maßnahmen</p>
            </div>
        `;
    }
}

function renderDashboardDonutChart(verteilung) {
    if (!verteilung) return;
    // Update legend values
    elements.donutGruen.textContent = verteilung.gruen;
    elements.donutGelb.textContent = verteilung.gelb;
    elements.donutRot.textContent = verteilung.rot;

    const total = verteilung.gruen + verteilung.gelb + verteilung.rot;

    // Destroy existing chart if exists
    if (state.dashboardDonutChartInstance) {
        state.dashboardDonutChartInstance.destroy();
    }

    const ctx = elements.dashboardDonutChart.getContext('2d');

    if (total === 0) {
        // No data - show empty state
        state.dashboardDonutChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Keine Daten'],
                datasets: [{
                    data: [1],
                    backgroundColor: ['#e5e7eb'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
        return;
    }

    const style = getComputedStyle(document.documentElement);
    const successColor = style.getPropertyValue('--success').trim() || '#22c55e';
    const warningColor = style.getPropertyValue('--warning').trim() || '#f59e0b';
    const dangerColor = style.getPropertyValue('--danger').trim() || '#ef4444';

    state.dashboardDonutChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Grün', 'Gelb', 'Rot'],
            datasets: [{
                data: [verteilung.gruen, verteilung.gelb, verteilung.rot],
                backgroundColor: [successColor, warningColor, dangerColor],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            const percent = ((value / total) * 100).toFixed(1);
                            return `${context.label}: ${value} (${percent}%)`;
                        }
                    }
                }
            },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const categories = ['gruen', 'gelb', 'rot'];
                    showLieferantenDetailModal(categories[index]);
                }
            }
        }
    });
}

function getResultClass(ergebnis) {
    if (ergebnis >= state.settings.threshold_success) return 'success';
    if (ergebnis >= state.settings.threshold_warning) return 'warning';
    return 'danger';
}

// ============================================================================
// Lieferanten Detail Modal
// ============================================================================

function showLieferantenDetailModal(category) {
    if (!state.dashboardData) {
        return;
    }

    let title = '';
    let iconClass = '';
    let lieferanten = [];

    switch (category) {
        case 'kritisch':
            title = 'Kritische Lieferanten';
            iconClass = 'danger';
            lieferanten = state.dashboardData.kritische_lieferanten.map(l => ({
                name: l.name,
                score: l.letztes_ergebnis,
                datum: l.datum,
                scoreClass: l.letztes_ergebnis < state.settings.threshold_warning ? 'danger' : 'warning'
            }));
            break;
        case 'gruen':
            title = 'Grün bewertete Lieferanten';
            iconClass = 'success';
            lieferanten = state.dashboardData.lieferanten_nach_kategorie?.gruen || [];
            break;
        case 'gelb':
            title = 'Gelb bewertete Lieferanten';
            iconClass = 'warning';
            lieferanten = state.dashboardData.lieferanten_nach_kategorie?.gelb || [];
            break;
        case 'rot':
            title = 'Rot bewertete Lieferanten';
            iconClass = 'danger';
            lieferanten = state.dashboardData.lieferanten_nach_kategorie?.rot || [];
            break;
    }

    elements.lieferantenDetailTitle.textContent = title;
    elements.lieferantenDetailIcon.className = 'lieferanten-detail-icon ' + iconClass;

    if (lieferanten.length > 0) {
        elements.lieferantenDetailList.innerHTML = lieferanten.map(l => `
            <div class="lieferanten-detail-item" data-lieferant="${escapeHtml(l.name)}">
                <span class="lieferanten-detail-name">${escapeHtml(l.name)}</span>
                <span class="lieferanten-detail-score ${l.scoreClass}">${l.score.toFixed(1)}%</span>
                <span class="lieferanten-detail-date">${formatDate(l.datum)}</span>
            </div>
        `).join('');
        // Event-Listener via Event-Delegation in setupEventListeners()
    } else {
        elements.lieferantenDetailList.innerHTML = `
            <div class="dashboard-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <polyline points="20,6 9,17 4,12"/>
                </svg>
                <p>Keine Lieferanten in dieser Kategorie</p>
            </div>
        `;
    }

    elements.lieferantenDetailModal.classList.add('visible');
}

// ============================================================================
// Vorquartal Maßnahmen
// ============================================================================

async function loadVorquartalMassnahmen() {
    const lieferant = elements.lieferantSelect.value;
    const datum = formatDateISO(state.selectedDate);

    if (!lieferant) {
        hideVorquartalPanel();
        return;
    }

    // Panel nicht mehr anzeigen, wenn es in dieser Session geschlossen wurde
    // Aber NUR für den gleichen Lieferanten
    if (state.vorquartalPanelDismissed && state.vorquartalDismissedFor === lieferant) {
        return;
    }

    // Reset dismissed flag wenn anderer Lieferant gewählt wird
    if (state.vorquartalDismissedFor !== lieferant) {
        state.vorquartalPanelDismissed = false;
    }

    // Race condition protection - aber Panel sofort verstecken wenn neue Anfrage kommt
    if (state.isLoadingVorquartal) {
        // Neue Anfrage angefordert während alte noch läuft
        // Markiere dass Ergebnis der alten Anfrage ignoriert werden soll
        state.vorquartalRequestId = (state.vorquartalRequestId || 0) + 1;
    }
    state.isLoadingVorquartal = true;

    // Store current context to check if it changed during async operation
    const requestedLieferant = lieferant;
    const requestedDatum = datum;
    const requestId = state.vorquartalRequestId || 0;

    try {
        const lieferantId = parseInt(lieferant);
        const result = await invoke('get_vorquartal_massnahmen_cmd', { lieferantId, datum });

        // Check if lieferant or datum changed during request - ignore stale response
        if (elements.lieferantSelect.value !== requestedLieferant ||
            formatDateISO(state.selectedDate) !== requestedDatum ||
            (state.vorquartalRequestId || 0) !== requestId) {
            return;
        }

        if (result && result.massnahmen) {
            state.vorquartalMassnahmen = result;
            showVorquartalPanel(result);
        } else {
            state.vorquartalMassnahmen = null;
            hideVorquartalPanel();
        }
    } catch (e) {
        console.error('Error loading Vorquartal Maßnahmen:', e);
        state.vorquartalMassnahmen = null;
        hideVorquartalPanel();
    } finally {
        state.isLoadingVorquartal = false;
    }
}

function showVorquartalPanel(data) {
    if (!data || !data.datum) return;
    // Quartal aus Datum berechnen
    const dateParts = data.datum.split('-');
    const month = parseInt(dateParts[1]);
    const year = dateParts[0];
    const quarter = Math.ceil(month / 3);

    elements.vorquartalQuartal.textContent = `Q${quarter} ${year}`;
    elements.vorquartalDate.textContent = formatDate(data.datum);

    const resultClass = getResultClass(data.ergebnis);
    elements.vorquartalResult.textContent = data.ergebnis.toFixed(1) + '%';
    elements.vorquartalResult.className = 'vorquartal-result ' + resultClass;

    elements.vorquartalText.textContent = data.massnahmen;
    elements.vorquartalUmgesetzt.checked = false;

    elements.vorquartalPanel.style.display = 'block';
}

function hideVorquartalPanel() {
    elements.vorquartalPanel.style.display = 'none';
}

function closeVorquartalPanel() {
    hideVorquartalPanel();
    state.vorquartalPanelDismissed = true;
    state.vorquartalDismissedFor = elements.lieferantSelect.value;
}

// ============================================================================
// Settings View
// ============================================================================

async function populateSettingsView() {
    // Profil
    if (state.currentUser) {
        elements.settingsUsername.textContent = state.currentUser.username;
        elements.settingsUserRole.textContent = formatRole(state.currentUser.role);
    }

    // Schwellenwerte
    if (elements.svThresholdSuccess) {
        elements.svThresholdSuccess.value = state.settings.threshold_success;
        elements.svThresholdWarning.value = state.settings.threshold_warning;
        updateSettingsViewPreview();
    }

    // Dashboard & Limits
    if (elements.svDashboardTopLimit) {
        elements.svDashboardTopLimit.value = state.settings.dashboard_top_limit;
        elements.svDashboardRecentLimit.value = state.settings.dashboard_recent_limit;
        elements.svDashboardCriticalLimit.value = state.settings.dashboard_critical_limit;
        elements.svBackupRetentionDays.value = state.settings.backup_retention_days;
    }

    // DB-Pfad
    try {
        const path = await invoke('get_current_db_path');
        elements.settingsDbPath.textContent = path;
    } catch (e) {
        elements.settingsDbPath.textContent = '—';
    }

    // Backup-Liste laden (admin-only)
    if (hasAdminAccess()) {
        loadBackupList();
    }

    // App-Info laden
    loadAppInfo();

    // Audit-Log Karte: auch für member + controlling sichtbar
    if (state.currentUser) {
        const role = state.currentUser.role;
        if (role === 'member' || role === 'controlling') {
            if (elements.settingsAuditCard) elements.settingsAuditCard.style.display = 'block';
        }
        // Datenbank-Karte: nur Admin + Controlling
        const dbCard = document.getElementById('settingsDbCard');
        if (dbCard) {
            dbCard.style.display = role === 'member' ? 'none' : '';
        }
    }

    // Layout dynamisch anpassen je nach sichtbaren Karten
    adjustSettingsLayout();
}

function adjustSettingsLayout() {
    const container = document.querySelector('.settings-container');
    if (!container) return;

    // Leere Spalten-Container ausblenden
    const columns = container.querySelectorAll('.settings-column');
    let visibleCols = 0;
    columns.forEach(col => {
        const hasVisible = col.querySelector('.settings-card:not([style*="display: none"])');
        if (hasVisible) {
            col.style.display = '';
            visibleCols++;
        } else {
            col.style.display = 'none';
        }
    });

    // Grid-Spalten an sichtbare Spalten anpassen
    container.style.gridTemplateColumns = 'repeat(' + Math.max(visibleCols, 1) + ', 1fr)';
}

function updateSettingsViewPreview() {
    const warning = parseFloat(elements.svThresholdWarning.value) || 50;
    elements.svThresholdDanger.textContent = warning + '%';
}

async function saveSettingsFromView() {
    const success = parseFloat(elements.svThresholdSuccess.value);
    const warning = parseFloat(elements.svThresholdWarning.value);

    if (isNaN(success) || isNaN(warning)) {
        showToast('Bitte gültige Zahlenwerte eingeben', 'warning');
        return;
    }

    if (success <= warning) {
        showToast('Erfolgs-Schwellenwert muss größer als Warn-Schwellenwert sein', 'warning');
        return;
    }

    if (success > 100 || success < 0 || warning > 100 || warning < 0) {
        showToast('Schwellenwerte müssen zwischen 0 und 100 liegen', 'warning');
        return;
    }

    try {
        await invoke('update_settings_cmd', {
            settings: {
                threshold_success: success,
                threshold_warning: warning,
                dashboard_top_limit: state.settings.dashboard_top_limit,
                dashboard_recent_limit: state.settings.dashboard_recent_limit,
                dashboard_critical_limit: state.settings.dashboard_critical_limit,
                backup_retention_days: state.settings.backup_retention_days
            }
        });

        state.settings.threshold_success = success;
        state.settings.threshold_warning = warning;

        showToast('Einstellungen gespeichert', 'success');

        // UI aktualisieren
        updateResult();
        loadHistorie();
        loadDashboard();
    } catch (e) {
        showToast('Fehler beim Speichern: ' + e, 'error');
    }
}

async function saveLimitsFromView() {
    const topLimit = parseInt(elements.svDashboardTopLimit.value);
    const recentLimit = parseInt(elements.svDashboardRecentLimit.value);
    const criticalLimit = parseInt(elements.svDashboardCriticalLimit.value);
    const retentionDays = parseInt(elements.svBackupRetentionDays.value);

    if ([topLimit, recentLimit, criticalLimit, retentionDays].some(v => isNaN(v))) {
        showToast('Bitte gültige Zahlenwerte eingeben', 'warning');
        return;
    }

    if (topLimit < 1 || topLimit > 50 || recentLimit < 1 || recentLimit > 50 || criticalLimit < 1 || criticalLimit > 50) {
        showToast('Dashboard-Limits müssen zwischen 1 und 50 liegen', 'warning');
        return;
    }

    if (retentionDays < 1 || retentionDays > 365) {
        showToast('Backup-Aufbewahrung muss zwischen 1 und 365 Tagen liegen', 'warning');
        return;
    }

    try {
        await invoke('update_settings_cmd', {
            settings: {
                threshold_success: state.settings.threshold_success,
                threshold_warning: state.settings.threshold_warning,
                dashboard_top_limit: topLimit,
                dashboard_recent_limit: recentLimit,
                dashboard_critical_limit: criticalLimit,
                backup_retention_days: retentionDays
            }
        });

        state.settings.dashboard_top_limit = topLimit;
        state.settings.dashboard_recent_limit = recentLimit;
        state.settings.dashboard_critical_limit = criticalLimit;
        state.settings.backup_retention_days = retentionDays;

        showToast('Limits gespeichert', 'success');
        loadDashboard();
    } catch (e) {
        showToast('Fehler beim Speichern: ' + e, 'error');
    }
}

// ============================================================================
// Backup-Verwaltung
// ============================================================================

async function loadBackupList() {
    if (!elements.backupListContainer) return;
    try {
        const backups = await invoke('list_backups_cmd');
        if (backups.length === 0) {
            elements.backupListContainer.innerHTML = '<p class="settings-hint" style="text-align:center;padding:8px 0;">Keine Backups vorhanden</p>';
            return;
        }
        let html = '<div class="backup-list">';
        for (const b of backups) {
            const sizeKb = (b.size_bytes / 1024).toFixed(0);
            const sizeMb = (b.size_bytes / (1024 * 1024)).toFixed(1);
            const sizeStr = b.size_bytes > 1024 * 1024 ? sizeMb + ' MB' : sizeKb + ' KB';
            html += `<div class="backup-list-item">
                <div class="backup-item-info">
                    <span class="backup-item-name">${b.filename}</span>
                    <span class="backup-item-meta">${b.created_at} · ${sizeStr}</span>
                </div>
                <div class="backup-item-actions">
                    <button class="btn btn-ghost btn-sm backup-restore-btn" data-filename="${b.filename}" title="Wiederherstellen">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                            <polyline points="1,4 1,10 7,10"/>
                            <path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
                        </svg>
                    </button>
                    <button class="btn btn-ghost btn-sm backup-delete-btn" data-filename="${b.filename}" title="Löschen">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                            <polyline points="3,6 5,6 21,6"/>
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>`;
        }
        html += '</div>';
        elements.backupListContainer.innerHTML = html;

        // Event delegation for backup actions
        elements.backupListContainer.querySelectorAll('.backup-restore-btn').forEach(btn => {
            btn.addEventListener('click', () => restoreBackup(btn.dataset.filename));
        });
        elements.backupListContainer.querySelectorAll('.backup-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => deleteBackup(btn.dataset.filename));
        });
    } catch (e) {
        elements.backupListContainer.innerHTML = '<p class="settings-hint" style="color:var(--danger-color);">Fehler beim Laden der Backups</p>';
    }
}

async function createBackup() {
    try {
        const filename = await invoke('create_backup_cmd');
        showToast('Backup erstellt: ' + filename, 'success');
        loadBackupList();
    } catch (e) {
        showToast('Backup fehlgeschlagen: ' + e, 'error');
    }
}

function restoreBackup(filename) {
    showConfirmDialog(
        'Backup wiederherstellen',
        `Datenbank aus Backup "${filename}" wiederherstellen?\n\nVor der Wiederherstellung wird automatisch ein Sicherheitsbackup erstellt. Die Anwendung wird nach der Wiederherstellung neu geladen.`,
        async () => {
            try {
                await invoke('restore_backup_cmd', { filename });
                showToast('Datenbank wiederhergestellt. Seite wird neu geladen...', 'success');
                setTimeout(() => window.location.reload(), 1500);
            } catch (e) {
                showToast('Wiederherstellung fehlgeschlagen: ' + e, 'error');
            }
        },
        'Wiederherstellen'
    );
}

function deleteBackup(filename) {
    showConfirmDialog(
        'Backup löschen',
        `Möchten Sie das Backup "${filename}" wirklich unwiderruflich löschen?`,
        async () => {
            try {
                await invoke('delete_backup_cmd', { filename });
                showToast('Backup gelöscht', 'success');
                loadBackupList();
            } catch (e) {
                showToast('Fehler beim Löschen: ' + e, 'error');
            }
        },
        'Löschen',
        true
    );
}

// ============================================================================
// App-Info
// ============================================================================

async function loadAppInfo() {
    try {
        const info = await invoke('get_app_info_cmd');
        if (elements.appInfoVersion) elements.appInfoVersion.textContent = 'v' + info.version;
        if (elements.appInfoBewertungen) elements.appInfoBewertungen.textContent = info.bewertungen_count;
        if (elements.appInfoLieferanten) elements.appInfoLieferanten.textContent = info.lieferanten_count;
        if (elements.appInfoFragen) elements.appInfoFragen.textContent = info.fragen_count;
        if (elements.appInfoUsers) elements.appInfoUsers.textContent = info.users_count;
        if (elements.appInfoDbSize) {
            const sizeMb = (info.db_size_bytes / (1024 * 1024)).toFixed(2);
            elements.appInfoDbSize.textContent = sizeMb + ' MB';
        }
        if (elements.appInfoOs) elements.appInfoOs.textContent = info.os_info;
    } catch (e) {
        // Silent fail — App-Info ist nicht kritisch
    }
}

// ============================================================================
// Phase 6: Ziele & Sollwerte
// ============================================================================

function generateQuartalOptions() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const currentQ = Math.ceil(month / 3);
    const options = [];

    // Aktuelles Quartal + alle zukünftigen bis Ende nächstes Jahr
    for (let offset = 0; offset <= 7; offset++) {
        let q = currentQ + offset;
        let y = year;
        while (q > 4) { q -= 4; y++; }
        options.push(`Q${q} ${y}`);
    }
    return options;
}

function getQuartalFromDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length < 2) return '';
    const y = parseInt(parts[0]);
    const m = parseInt(parts[1]);
    const q = Math.ceil(m / 3);
    return `Q${q} ${y}`;
}

// Helper: Custom-Dropdown für Ziele befüllen und Klick-Handler setzen
function populateZielDropdown(wrapper, input, dropdown, hiddenInput, options, selectedValue, placeholder) {
    // Supports both [{id, name}] objects and plain string arrays
    const isObjectArray = options.length > 0 && typeof options[0] === 'object' && options[0].id !== undefined;

    let html = '';
    if (placeholder) {
        html += `<div class="custom-dropdown-item ${!selectedValue ? 'selected' : ''}" data-value="">${placeholder}</div>`;
    }
    for (const opt of options) {
        const val = isObjectArray ? opt.id : opt;
        const display = isObjectArray ? opt.name : opt;
        const sel = String(val) === String(selectedValue) ? ' selected' : '';
        html += `<div class="custom-dropdown-item${sel}" data-value="${escapeHtml(String(val))}">${escapeHtml(display)}</div>`;
    }
    dropdown.innerHTML = html;

    if (selectedValue) {
        if (isObjectArray) {
            const selObj = options.find(o => String(o.id) === String(selectedValue));
            input.value = selObj ? selObj.name : selectedValue;
        } else {
            input.value = selectedValue;
        }
        hiddenInput.value = selectedValue;
    } else {
        input.value = placeholder || '';
        hiddenInput.value = '';
    }

    // Click on wrapper toggles dropdown (use onclick to avoid listener accumulation)
    input.onclick = (e) => {
        e.stopPropagation();
        if (input.classList.contains('disabled')) return;
        dropdown.classList.toggle('visible');
    };

    // Event delegation on dropdown (use onclick to replace previous handler)
    dropdown.onclick = (e) => {
        const item = e.target.closest('.custom-dropdown-item');
        if (!item) return;
        const val = item.dataset.value;
        hiddenInput.value = val;
        input.value = item.textContent || placeholder || '';
        dropdown.querySelectorAll('.custom-dropdown-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        dropdown.classList.remove('visible');
        // Fire change event on hidden input
        hiddenInput.dispatchEvent(new Event('change'));
    };
}

async function openZieleManagement() {
    showModal('zieleManagementModal');

    // Quartal-Filter füllen
    const quartale = generateQuartalOptions();
    const now = new Date();
    const currentQ = `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`;

    populateZielDropdown(
        elements.zieleFilterQuartalWrapper,
        elements.zieleFilterQuartalInput,
        elements.zieleFilterQuartalDropdown,
        elements.zieleFilterQuartal,
        quartale, currentQ, 'Alle Quartale'
    );

    await loadZiele(currentQ);
}

async function loadZiele(quartal) {
    try {
        const params = {};
        if (quartal) params.quartal = quartal;
        const ziele = await invoke('get_ziele_cmd', params);
        state.zieleData = ziele;
        renderZieleList(ziele);
    } catch (e) {
        showToast('Fehler beim Laden der Ziele: ' + e, 'error');
    }
}

function renderZieleList(ziele) {
    if (!elements.zieleListContainer) return;

    if (!ziele || ziele.length === 0) {
        elements.zieleListContainer.innerHTML = '<p class="settings-hint">Keine Ziele vorhanden.</p>';
        return;
    }

    let html = `<table class="ziel-list-table">
        <thead><tr>
            <th>Lieferant</th>
            <th>Quartal</th>
            <th>Zielwert</th>
            <th>Beschreibung</th>
            <th>Aktionen</th>
        </tr></thead><tbody>`;

    for (const z of ziele) {
        html += `<tr>
            <td>${escapeHtml(z.lieferant)}</td>
            <td>${escapeHtml(z.quartal)}</td>
            <td><strong>${z.zielwert.toFixed(1)}%</strong></td>
            <td>${z.beschreibung ? escapeHtml(z.beschreibung) : '—'}</td>
            <td class="ziel-list-actions">
                <button class="btn btn-sm btn-ghost ziel-edit-btn" data-ziel-id="${z.id}" title="Bearbeiten">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="btn btn-sm btn-ghost ziel-delete-btn" data-ziel-id="${z.id}" title="Löschen" style="color: var(--danger);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
            </td>
        </tr>`;
    }

    html += '</tbody></table>';
    elements.zieleListContainer.innerHTML = html;

    // Event-Delegation für Edit/Delete Buttons
    elements.zieleListContainer.querySelectorAll('.ziel-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => openZielForm(parseInt(btn.dataset.zielId)));
    });
    elements.zieleListContainer.querySelectorAll('.ziel-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteZiel(parseInt(btn.dataset.zielId)));
    });
}

async function openZielForm(id) {
    state.editZielId = id;

    // Lieferanten-Dropdown füllen
    const lieferanten = state.lieferanten.length > 0 ? state.lieferanten : await invoke('get_lieferanten');
    const quartale = generateQuartalOptions();

    if (id) {
        // Bearbeiten: Ziel-Daten laden
        elements.zielFormTitle.textContent = 'Ziel bearbeiten';
        const ziel = state.zieleData.find(z => z.id === id);
        if (ziel) {
            populateZielDropdown(
                elements.zielLieferantWrapper, elements.zielLieferantInput,
                elements.zielLieferantDropdown, elements.zielLieferantSelect,
                lieferanten, ziel.lieferant_id, 'Lieferant wählen'
            );
            // Bei Bearbeiten: Lieferant + Quartal sperren
            elements.zielLieferantInput.classList.add('disabled');
            // Quartal: aktuelles Ziel-Quartal immer als Option aufnehmen
            const qOpts = quartale.includes(ziel.quartal) ? quartale : [ziel.quartal, ...quartale];
            populateZielDropdown(
                elements.zielQuartalWrapper, elements.zielQuartalInput,
                elements.zielQuartalDropdown, elements.zielQuartalSelect,
                qOpts, ziel.quartal, null
            );
            elements.zielQuartalInput.classList.add('disabled');

            elements.zielWertInput.value = ziel.zielwert;
            elements.zielBeschreibungInput.value = ziel.beschreibung || '';
        }
    } else {
        // Neu
        elements.zielFormTitle.textContent = 'Neues Ziel erstellen';
        populateZielDropdown(
            elements.zielLieferantWrapper, elements.zielLieferantInput,
            elements.zielLieferantDropdown, elements.zielLieferantSelect,
            lieferanten, '', 'Lieferant wählen'
        );
        elements.zielLieferantInput.classList.remove('disabled');

        populateZielDropdown(
            elements.zielQuartalWrapper, elements.zielQuartalInput,
            elements.zielQuartalDropdown, elements.zielQuartalSelect,
            quartale, quartale[0] || '', null
        );
        elements.zielQuartalInput.classList.remove('disabled');

        elements.zielWertInput.value = '';
        elements.zielBeschreibungInput.value = '';
    }

    showModal('zielFormModal');
}

async function saveZiel() {
    const lieferant = elements.zielLieferantSelect.value;
    const quartal = elements.zielQuartalSelect.value;
    const zielwert = parseFloat(elements.zielWertInput.value);
    const beschreibung = elements.zielBeschreibungInput.value.trim() || null;

    if (!state.editZielId && !lieferant) {
        showToast('Bitte Lieferant auswählen', 'error');
        return;
    }
    if (!quartal) {
        showToast('Bitte Quartal auswählen', 'error');
        return;
    }
    if (isNaN(zielwert) || zielwert < 0 || zielwert > 100) {
        showToast('Zielwert muss zwischen 0 und 100 liegen', 'error');
        return;
    }

    try {
        if (state.editZielId) {
            await invoke('update_ziel_cmd', {
                id: state.editZielId,
                zielwert: zielwert,
                beschreibung: beschreibung
            });
            showToast('Ziel aktualisiert', 'success');
        } else {
            const lieferantIdForZiel = parseInt(lieferant) || null;
            const lieferantNameForZiel = getLieferantNameById(lieferantIdForZiel) || lieferant;
            await invoke('create_ziel_cmd', {
                ziel: {
                    lieferant_id: lieferantIdForZiel,
                    lieferant: lieferantNameForZiel,
                    se_team: null,
                    quartal: quartal,
                    zielwert: zielwert,
                    beschreibung: beschreibung
                }
            });
            showToast('Ziel erstellt', 'success');
        }

        hideModal('zielFormModal');
        await loadZiele(elements.zieleFilterQuartal.value);
    } catch (e) {
        showToast('Fehler: ' + e, 'error');
    }
}

async function deleteZiel(id) {
    const ziel = state.zieleData.find(z => z.id === id);
    if (!ziel) return;

    showConfirmDialog(
        'Ziel löschen',
        `Ziel für "${ziel.lieferant}" (${ziel.quartal}, ${ziel.zielwert.toFixed(1)}%) wirklich löschen?`,
        async () => {
            try {
                await invoke('delete_ziel_cmd', { id: id });
                showToast('Ziel gelöscht', 'success');
                await loadZiele(elements.zieleFilterQuartal.value);
            } catch (e) {
                showToast('Fehler: ' + e, 'error');
            }
        }
    );
}

// Dashboard Ziele Widget Rendering
function renderDashboardZiele(data) {
    if (!elements.dashboardZieleWidget) return;

    const summary = data.ziele_summary;
    if (!summary || summary.details.length === 0) {
        elements.dashboardZieleWidget.style.display = 'none';
        return;
    }

    elements.dashboardZieleWidget.style.display = '';

    // Summary Bar
    elements.zieleSummaryBar.innerHTML = `
        <div class="ziele-summary-stat">
            <span class="stat-dot gruen"></span>
            <span class="stat-value">${summary.erreicht}</span>
            <span>Erreicht</span>
        </div>
        <div class="ziele-summary-stat">
            <span class="stat-dot gelb"></span>
            <span class="stat-value">${summary.knapp}</span>
            <span>Knapp</span>
        </div>
        <div class="ziele-summary-stat">
            <span class="stat-dot rot"></span>
            <span class="stat-value">${summary.verfehlt}</span>
            <span>Verfehlt</span>
        </div>
        <div class="ziele-summary-stat">
            <span class="stat-dot keine"></span>
            <span class="stat-value">${summary.ohne_bewertung}</span>
            <span>Ausstehend</span>
        </div>
    `;

    // Details List
    let detailsHtml = '';
    for (const d of summary.details) {
        const istVal = d.ist_wert !== null ? d.ist_wert.toFixed(1) : '—';
        const istWidth = d.ist_wert !== null ? Math.min(d.ist_wert, 100) : 0;
        const sollWidth = Math.min(d.zielwert, 100);

        let diffHtml = '';
        if (d.differenz !== null) {
            const sign = d.differenz >= 0 ? '+' : '';
            const diffClass = d.differenz >= 0 ? 'positiv' : 'negativ';
            diffHtml = `<span class="ziel-item-diff ${diffClass}">${sign}${d.differenz.toFixed(1)}%</span>`;
        } else {
            diffHtml = '<span class="ziel-item-diff neutral">—</span>';
        }

        detailsHtml += `
            <div class="ziel-item">
                <span class="ziel-ampel ${d.ampel}"></span>
                <span class="ziel-item-name">${escapeHtml(d.lieferant)}<small class="ziel-item-quartal">${escapeHtml(d.quartal)}</small></span>
                <div class="ziel-item-bars">
                    <div class="ziel-bar-row">
                        <span class="ziel-bar-label">Ist</span>
                        <div class="ziel-bar">
                            <div class="ziel-bar-fill ist ${d.ampel}" style="width: ${istWidth}%"></div>
                        </div>
                        <span class="ziel-bar-value">${istVal}%</span>
                    </div>
                    <div class="ziel-bar-row">
                        <span class="ziel-bar-label">Soll</span>
                        <div class="ziel-bar">
                            <div class="ziel-bar-fill soll" style="width: ${sollWidth}%"></div>
                        </div>
                        <span class="ziel-bar-value">${d.zielwert.toFixed(1)}%</span>
                    </div>
                </div>
                ${diffHtml}
            </div>
        `;
    }
    elements.zieleDetailsList.innerHTML = detailsHtml;
}

// ============================================================================
// User Management
// ============================================================================

let editingUserId = null;

async function openUserManagement() {
    showModal('userManagementModal');
    await loadUsers();
}

async function loadUsers() {
    try {
    const users = await invoke('get_users');
        renderUserList(users);
    } catch (e) {
        showStatus('Fehler beim Laden der Benutzer: ' + e, true);
    }
}

function renderUserList(users) {
    elements.userList.innerHTML = users.map(user => `
        <div class="user-item" data-user-id="${user.id}">
            <div class="user-item-info">
                <span class="user-item-name">${escapeHtml(user.username)}</span>
                <div class="user-item-meta">
                    <span class="user-item-role ${user.role}">${formatRole(user.role)}</span>
                    <span class="user-item-status ${user.active ? 'active' : 'inactive'}">${user.active ? 'Aktiv' : 'Inaktiv'}</span>
                </div>
            </div>
            <div class="user-item-actions">
                <button class="btn btn-secondary edit-user-btn" data-user-id="${user.id}">Bearbeiten</button>
            </div>
        </div>
    `).join('');

    // Event listeners for edit buttons
    elements.userList.querySelectorAll('.edit-user-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditUser(parseInt(btn.dataset.userId)));
    });
}

function formatRole(role) {
    switch ((role || '').toLowerCase()) {
        case 'admin':
            return 'Admin';
        case 'controlling':
            return 'Controlling';
        case 'member':
            return 'Member';
        case 'user':
            return 'Benutzer';
        default:
            return role || '-';
    }
}

async function createUser() {
    const username = elements.newUsername.value.trim();
    const password = elements.newUserPassword.value;
    const role = elements.newUserRole.value;

    if (!username || !password) {
        showStatus('Bitte Benutzername und Passwort eingeben', true);
        return;
    }

    if (password.length < 8) {
        showStatus('Passwort muss mindestens 8 Zeichen haben', true);
        return;
    }

    try {
        await invoke('create_user', { username, password, role });
        hideModal('newUserModal');
        elements.newUsername.value = '';
        elements.newUserPassword.value = '';
        elements.newUserRole.value = 'member';
        await loadUsers();
        showStatus('Benutzer erfolgreich angelegt', false);
    } catch (e) {
        showStatus('Fehler beim Anlegen: ' + e, true);
    }
}

async function openEditUser(userId) {
    editingUserId = userId;
    try {
        const users = await invoke('get_users');
        const user = users.find(u => u.id === userId);
        if (user) {
            elements.editUsername.value = user.username;
            elements.editUserRole.value = user.role;
            elements.editUserRoleInput.value = formatRole(user.role);
            elements.editUserActive.value = user.active ? '1' : '0';
            elements.editUserActiveInput.value = user.active ? 'Aktiv' : 'Inaktiv';
            elements.editUserNewPassword.value = '';
            showModal('editUserModal');
        }
    } catch (e) {
        showStatus('Fehler beim Laden: ' + e, true);
    }
}

async function updateUser() {
    if (!editingUserId) return;

    const role = elements.editUserRole.value;
    const active = elements.editUserActive.value === '1';
    const newPassword = elements.editUserNewPassword.value;

    try {
        await invoke('update_user', { id: editingUserId, role, active });

        if (newPassword) {
            if (newPassword.length < 8) {
                showStatus('Passwort muss mindestens 8 Zeichen haben', true);
                return;
            }
            await invoke('reset_user_password', { id: editingUserId, newPassword });
        }

        hideModal('editUserModal');
        await loadUsers();
        showStatus('Benutzer erfolgreich aktualisiert', false);
    } catch (e) {
        showStatus('Fehler beim Aktualisieren: ' + e, true);
    }
}

function deleteUser() {
    if (!editingUserId) return;

    const username = elements.editUsername.value;

    showConfirmDialog(
        'Benutzer löschen',
        `Benutzer "${escapeHtml(username)}" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
        async () => {
            try {
                await invoke('delete_user', { id: editingUserId });
                hideModal('editUserModal');
                await loadUsers();
                showStatus('Benutzer erfolgreich gelöscht', false);
            } catch (e) {
                showStatus('Fehler beim Löschen: ' + e, true);
            }
        },
        'Löschen',
        true // danger style
    );
}

// ============================================================================
// Audit Log
// ============================================================================

let auditModalEntries = [];
let auditModalFilter = 'all';

async function openAuditLog() {
    showModal('auditLogModal');
    auditModalFilter = 'all';
    if (elements.auditModalSearch) elements.auditModalSearch.value = '';
    // Reset filter buttons
    document.querySelectorAll('[data-audit-filter]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.auditFilter === 'all');
    });
    await loadAuditLog();
}

async function loadAuditLog() {
    try {
        auditModalEntries = await invoke('get_audit_log', { limit: 500 });
        renderAuditLog(auditModalEntries);
    } catch (e) {
        showStatus('Fehler beim Laden des Audit-Logs: ' + e, true);
    }
}

function filterAuditModal() {
    const searchText = (elements.auditModalSearch ? elements.auditModalSearch.value : '').toLowerCase();
    const items = elements.auditLogList.querySelectorAll('.audit-log-item');
    let visibleCount = 0;
    items.forEach(item => {
        const matchesAction = auditModalFilter === 'all' || item.dataset.action === auditModalFilter;
        const matchesSearch = !searchText || item.textContent.toLowerCase().includes(searchText);
        const visible = matchesAction && matchesSearch;
        item.classList.toggle('audit-hidden', !visible);
        if (visible) visibleCount++;
    });
    if (elements.auditModalCount) {
        elements.auditModalCount.textContent = visibleCount + ' von ' + items.length + ' Einträgen';
    }
    // Scroll nach oben zurücksetzen damit gefilterte Ergebnisse sichtbar sind
    elements.auditLogList.scrollTop = 0;
}

function renderAuditLog(entries) {
    if (entries.length === 0) {
        elements.auditLogList.innerHTML = '<p style="text-align: center; color: var(--text-muted);">Keine Einträge vorhanden</p>';
        if (elements.auditModalCount) elements.auditModalCount.textContent = '';
        return;
    }

    elements.auditLogList.innerHTML = entries.map(entry => {
        const actionClass = 'audit-action-' + entry.action.toLowerCase().replace('_', '-');
        const actionLabel = {
            'CREATE': 'Erstellt',
            'UPDATE': 'Geändert',
            'DELETE': 'Gelöscht',
            'LOGIN_SUCCESS': 'Login erfolgreich',
            'LOGIN_FAILED': 'Login fehlgeschlagen',
            'LOGOUT': 'Abgemeldet',
            'VIEW': 'Angesehen',
            'EXPORT_PDF': 'PDF exportiert',
            'EXPORT_CSV': 'CSV exportiert',
            'EXPORT_IMAGE': 'Bild exportiert',
            'SWITCH_DB': 'DB gewechselt',
            'FACTORY_RESET_START': 'Reset gestartet',
            'FACTORY_RESET_COMPLETE': 'Reset abgeschlossen',
            'FACTORY_RESET_DENIED': 'Reset verweigert',
            'RENAME': 'Umbenannt'
        }[entry.action] || entry.action;

        const entityLabel = {
            'session': 'Sitzung',
            'bewertung': 'Bewertung',
            'lieferant': 'Lieferant',
            'se_team': 'SE-Team',
            'frage': 'Frage',
            'user': 'Benutzer',
            'user_password': 'Passwort',
            'settings': 'Einstellungen',
            'database': 'Datenbank',
            'system': 'System',
            'export': 'Export',
            'audit_log': 'Audit-Log',
            'backup': 'Backup',
            'backup': 'Backup',
            'massnahme': 'Maßnahme',
            'ziel': 'Ziel'
        }[entry.entity_type] || entry.entity_type;

        return `
            <div class="audit-log-item ${actionClass}" data-action="${entry.action}">
                <span class="audit-log-timestamp">${formatTimestamp(entry.timestamp)}</span>
                <div class="audit-log-content">
                    <span class="audit-log-action">${escapeHtml(actionLabel)}: ${escapeHtml(entityLabel)}</span>
                    <span class="audit-log-details">${escapeHtml(entry.details || '')}</span>
                </div>
                <span class="audit-log-user">${escapeHtml(entry.username)}</span>
            </div>
        `;
    }).join('');

    filterAuditModal();
}

function formatTimestamp(ts) {
    if (!ts) return '';
    // SQLite stores as UTC without timezone indicator - append 'Z' to treat as UTC
    const utcString = ts.includes('Z') ? ts : ts.replace(' ', 'T') + 'Z';
    const date = new Date(utcString);
    return date.toLocaleDateString('de-DE') + ' ' + date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// ============================================================================
// Changelog
// ============================================================================
function checkChangelog() {
    const currentVersion = APP_VERSION;
    const storageKey = 'changelogSeen_' + currentVersion;
    
    if (localStorage.getItem(storageKey) !== 'true') {
        // Show modal
        if (elements.changelogModal) {
            elements.changelogModal.classList.add('visible');
        }
    }
}

// ============================================================================
// Event Listeners
// ============================================================================
function setupEventListeners() {
    // =========================================================================
    // Event Delegation for Dynamic Content (prevents memory leaks)
    // =========================================================================

    // Dashboard: Missing Banner Items
    if (elements.missingBannerList) {
        elements.missingBannerList.addEventListener('click', (e) => {
            const item = e.target.closest('.missing-banner-item');
            if (item && item.dataset.lieferant) {
                switchView('bewertung');
                // Name→ID auflösen, da selectLieferant eine ID erwartet
                const lid = getLieferantIdByName(item.dataset.lieferant);
                if (lid) selectLieferant(String(lid));
            }
        });
    }

    // Dashboard: Top Performer Items
    if (elements.dashboardTopPerformer) {
        elements.dashboardTopPerformer.addEventListener('click', (e) => {
            const item = e.target.closest('.top-performer-item');
            if (item && item.dataset.lieferant) {
                switchToHistorieWithFilter({ lieferant: item.dataset.lieferant });
            }
        });
    }

    // Dashboard: Letzte Bewertungen Items
    if (elements.dashboardLetzteBewertungen) {
        elements.dashboardLetzteBewertungen.addEventListener('click', async (e) => {
            const item = e.target.closest('.letzte-item');
            if (item && item.dataset.id) {
                const id = parseInt(item.dataset.id, 10);
                if (!isNaN(id)) {
                    await loadBewertung(id);
                    switchView('bewertung');
                }
            }
        });
    }

    // Dashboard: Offene Massnahmen Items
    if (elements.dashboardOffeneMassnahmen) {
        elements.dashboardOffeneMassnahmen.addEventListener('click', async (e) => {
            const item = e.target.closest('.reminder-item');
            if (item && item.dataset.id) {
                const id = parseInt(item.dataset.id, 10);
                if (!isNaN(id)) {
                    await loadBewertung(id);
                    switchView('bewertung');
                }
            }
        });
    }

    // Dashboard: Lieferanten Detail List
    if (elements.lieferantenDetailList) {
        elements.lieferantenDetailList.addEventListener('click', (e) => {
            const item = e.target.closest('.lieferanten-detail-item');
            if (item && item.dataset.lieferant) {
                elements.lieferantenDetailModal.classList.remove('visible');
                switchToHistorieWithFilter({ lieferant: item.dataset.lieferant });
            }
        });
    }

    // Historie: Table Body Actions
    if (elements.historieBody) {
        elements.historieBody.addEventListener('click', async (e) => {
            const btn = e.target.closest('button');
            if (!btn || !btn.dataset.id) return;

            const id = parseInt(btn.dataset.id, 10);
            if (isNaN(id)) return;

            if (btn.dataset.permissionDenied) {
                if (btn.dataset.permissionDenied === 'edit') {
                    showToast('Bearbeiten ist nur für Administratoren und Controlling verfügbar.', 'warning');
                } else if (btn.dataset.permissionDenied === 'delete') {
                    showToast('Löschen ist nur für Administratoren verfügbar.', 'warning');
                }
                return;
            }

            if (btn.classList.contains('btn-load')) {
                await loadBewertung(id);
            } else if (btn.classList.contains('btn-edit')) {
                await editBewertung(id);
            } else if (btn.classList.contains('btn-pdf')) {
                await exportPdf(id);
            } else if (btn.classList.contains('btn-delete')) {
                confirmDeleteBewertung(id);
            }
        });
    }

    // Historie: Timeline Container Actions
    if (elements.timelineContainer) {
        elements.timelineContainer.addEventListener('click', async (e) => {
            // Handle card header clicks (toggle)
            const header = e.target.closest('.timeline-card-header');
            if (header && header.dataset.id) {
                const id = parseInt(header.dataset.id, 10);
                if (!isNaN(id)) {
                    toggleTimelineCard(e, id);
                }
                return;
            }

            // Handle action buttons
            const btn = e.target.closest('button');
            if (!btn || !btn.dataset.id) return;

            // Stop propagation for action buttons
            e.stopPropagation();

            const id = parseInt(btn.dataset.id, 10);
            if (isNaN(id)) return;

            if (btn.dataset.permissionDenied) {
                if (btn.dataset.permissionDenied === 'edit') {
                    showToast('Bearbeiten ist nur für Administratoren und Controlling verfügbar.', 'warning');
                } else if (btn.dataset.permissionDenied === 'delete') {
                    showToast('Löschen ist nur für Administratoren verfügbar.', 'warning');
                }
                return;
            }

            if (btn.classList.contains('btn-load')) {
                await loadBewertung(id);
            } else if (btn.classList.contains('btn-edit')) {
                await editBewertung(id);
            } else if (btn.classList.contains('btn-pdf')) {
                await exportPdf(id);
            } else if (btn.classList.contains('btn-delete')) {
                confirmDeleteBewertung(id);
            }
        });
    }

    // =========================================================================
    // Standard Event Listeners
    // =========================================================================

    // Navigation
    elements.navBtns.forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Sidebar toggle
    if (elements.sidebarCollapseBtn) {
        elements.sidebarCollapseBtn.addEventListener('click', toggleSidebar);
    }
    if (elements.sidebarSettingsBtn) {
        elements.sidebarSettingsBtn.addEventListener('click', () => switchView('settings'));
    }
    if (elements.sidebarToggleBtn) {
        elements.sidebarToggleBtn.addEventListener('click', toggleSidebar);
    }

    // Save & Reset
    elements.saveBtn.addEventListener('click', saveBewertung);
    elements.resetBtn.addEventListener('click', resetBewertung);
    elements.toggleGroupsBtn.addEventListener('click', toggleAllGroups);

    // Maßnahmen Panel
    elements.massnahmenBtn.addEventListener('click', toggleMassnahmenPanel);
    elements.massnahmenCloseBtn.addEventListener('click', closeMassnahmenPanel);
    elements.massnahmenInput.addEventListener('input', updateMassnahmenIndicator);

    // Strukturierte Maßnahmen
    if (elements.massnahmeAddBtn) {
        elements.massnahmeAddBtn.addEventListener('click', addPendingMassnahme);
    }
    if (elements.massnahmeDesc) {
        elements.massnahmeDesc.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addPendingMassnahme(); }
        });
    }
    if (elements.massnahmenListe) {
        elements.massnahmenListe.addEventListener('click', (e) => {
            const btn = e.target.closest('.massnahme-remove');
            if (btn) removePendingMassnahme(parseInt(btn.dataset.index));
        });
    }

    // Bestellnummer Auto-Resize
    elements.bestellnummerInput.addEventListener('input', autoResizeBestellnummer);
    // Initial resize in case of pre-filled content
    autoResizeBestellnummer();

    // Date Picker
    elements.datumInput.addEventListener('click', toggleDatePicker);
    elements.datePrevMonth.addEventListener('click', (e) => {
        e.stopPropagation();
        changeMonth(-1);
    });
    elements.dateNextMonth.addEventListener('click', (e) => {
        e.stopPropagation();
        changeMonth(1);
    });

    // Custom Dropdown: Lieferant
    elements.lieferantInput.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.lieferantDropdown.classList.toggle('visible');
        // Close SE-Team dropdown
        elements.seTeamDropdown.classList.remove('visible');
    });

    // Custom Dropdown: SE-Team (autocomplete)
    elements.seTeamInput.addEventListener('focus', () => {
        renderSeTeamDropdown(elements.seTeamInput.value);
        elements.seTeamDropdown.classList.add('visible');
    });

    elements.seTeamInput.addEventListener('input', () => {
        renderSeTeamDropdown(elements.seTeamInput.value);
        elements.seTeamDropdown.classList.add('visible');
    });

    // Custom Dropdown: Frage Gruppe (in modal)
    elements.frageGruppeInput.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.frageGruppeDropdown.classList.toggle('visible');
    });

    // Custom Dropdown: Historie Lieferant Filter
    elements.historieFilterInput.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllHistorieDropdowns();
        elements.historieFilterDropdown.classList.toggle('visible');
    });

    // Custom Dropdown: Historie SE-Team Filter
    elements.historieSeTeamFilterInput.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllHistorieDropdowns();
        elements.historieSeTeamFilterDropdown.classList.toggle('visible');
    });

    // Custom Dropdown: Historie Jahr Filter
    elements.historieJahrFilterInput.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllHistorieDropdowns();
        elements.historieJahrFilterDropdown.classList.toggle('visible');
    });

    // Custom Dropdown: Historie Quartal Filter
    elements.historieQuartalFilterInput.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllHistorieDropdowns();
        elements.historieQuartalFilterDropdown.classList.toggle('visible');
    });

    // Close all dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        // Close date picker
        if (!elements.datePickerWrapper.contains(e.target)) {
            elements.datePickerDropdown.classList.remove('visible');
        }
        // Close lieferant dropdown
        if (!elements.lieferantWrapper.contains(e.target)) {
            elements.lieferantDropdown.classList.remove('visible');
        }
        // Close SE-Team dropdown
        if (!elements.seTeamWrapper.contains(e.target)) {
            elements.seTeamDropdown.classList.remove('visible');
        }
        // Close Frage Gruppe dropdown
        if (!elements.frageGruppeWrapper.contains(e.target)) {
            elements.frageGruppeDropdown.classList.remove('visible');
        }
        // Close Historie dropdowns
        if (!elements.historieFilterWrapper.contains(e.target)) {
            elements.historieFilterDropdown.classList.remove('visible');
        }
        // Close login dropdown
        if (elements.loginDropdownWrapper && !elements.loginDropdownWrapper.contains(e.target)) {
            elements.loginDropdown.classList.remove('visible');
        }
        if (!elements.historieSeTeamFilterWrapper.contains(e.target)) {
            elements.historieSeTeamFilterDropdown.classList.remove('visible');
        }
        if (!elements.historieJahrFilterWrapper.contains(e.target)) {
            elements.historieJahrFilterDropdown.classList.remove('visible');
        }
        if (!elements.historieQuartalFilterWrapper.contains(e.target)) {
            elements.historieQuartalFilterDropdown.classList.remove('visible');
        }
        // Close Trends/Compare dropdowns
        if (elements.trendLieferantWrapper && !elements.trendLieferantWrapper.contains(e.target)) {
            elements.trendLieferantDropdown.classList.remove('visible');
        }
        if (elements.compare1Wrapper && !elements.compare1Wrapper.contains(e.target)) {
            elements.compare1Dropdown.classList.remove('visible');
        }
        if (elements.compare2Wrapper && !elements.compare2Wrapper.contains(e.target)) {
            elements.compare2Dropdown.classList.remove('visible');
        }
        // Close Dashboard Timeframe dropdown
        if (elements.dashboardTimeframeWrapper && !elements.dashboardTimeframeWrapper.contains(e.target)) {
            closeDashboardTimeframeDropdown();
        }
        // Close New User Role dropdown
        if (elements.newUserRoleWrapper && !elements.newUserRoleWrapper.contains(e.target)) {
            elements.newUserRoleDropdown.classList.remove('visible');
        }
        // Close Edit User Role dropdown
        if (elements.editUserRoleWrapper && !elements.editUserRoleWrapper.contains(e.target)) {
            elements.editUserRoleDropdown.classList.remove('visible');
        }
        // Close Edit User Active dropdown
        if (elements.editUserActiveWrapper && !elements.editUserActiveWrapper.contains(e.target)) {
            elements.editUserActiveDropdown.classList.remove('visible');
        }
    });

    // Lieferant Modal
    elements.addLieferantBtn.addEventListener('click', () => {
        renderLieferantenSelect(); // Re-render list when modal opens
        showModal('lieferantModal');
    });
    elements.cancelLieferant.addEventListener('click', () => hideModal('lieferantModal'));
    elements.confirmLieferant.addEventListener('click', addLieferant);
    elements.newLieferantInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addLieferant();
    });

    // SE-Team Modal
    elements.addSeTeamBtn.addEventListener('click', () => {
        renderSeTeamList(); // Re-render list when modal opens
        showModal('seTeamModal');
    });
    elements.cancelSeTeam.addEventListener('click', () => hideModal('seTeamModal'));
    elements.confirmSeTeam.addEventListener('click', addSeTeam);
    elements.newSeTeamInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addSeTeam();
    });

    // Delete Modal
    elements.cancelDelete.addEventListener('click', () => hideModal('deleteModal'));
    elements.confirmDelete.addEventListener('click', deleteBewertung);

    // Success Modal
    elements.confirmSuccess.addEventListener('click', () => {
        hideModal('successModal');
        resetBewertung(true); // silent reset after successful save
    });

    // Error Modal
    elements.confirmError.addEventListener('click', () => {
        hideModal('errorModal');
    });

    // Confirm Modal (for SE-Team/Lieferant delete)
    elements.cancelConfirm.addEventListener('click', () => {
        hideModal('confirmModal');
        state.confirmAction = null;
    });
    elements.confirmConfirm.addEventListener('click', () => {
        hideModal('confirmModal');
        if (state.confirmAction) {
            state.confirmAction();
            state.confirmAction = null;
        }
    });

    // Prompt Modal (for new group name)
    elements.cancelPrompt.addEventListener('click', () => {
        hideModal('promptModal');
        state.promptAction = null;
    });
    elements.confirmPrompt.addEventListener('click', () => {
        const value = elements.promptInput.value.trim();
        hideModal('promptModal');
        if (state.promptAction && value) {
            state.promptAction(value);
        }
        state.promptAction = null;
    });
    elements.promptInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            elements.confirmPrompt.click();
        }
    });

    // Edit Modal
    elements.cancelEdit.addEventListener('click', () => hideModal('editModal'));
    elements.confirmEdit.addEventListener('click', saveEditBewertung);
    elements.editBestellnummer.addEventListener('input', () => autoResizeTextarea(elements.editBestellnummer));

    // Login Modal
    elements.loginToggle.addEventListener('click', (e) => { e.stopPropagation(); toggleLogin(); });
    elements.cancelLogin.addEventListener('click', () => hideModal('loginModal'));
    elements.confirmLogin.addEventListener('click', doLogin);
    elements.loginPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') doLogin();
    });
    elements.loginSwitchDb.addEventListener('click', switchDatabaseFromLogin);

    // Password Modal
    elements.cancelPassword.addEventListener('click', () => hideModal('passwordModal'));
    elements.confirmPasswordChange.addEventListener('click', changePassword);

    // Settings View
    elements.settingsChangePasswordBtn.addEventListener('click', showPasswordModal);
    elements.settingsSwitchDbBtn.addEventListener('click', switchDatabaseDialog);
    elements.settingsFactoryResetBtn.addEventListener('click', factoryResetDialog);
    elements.svThresholdSuccess.addEventListener('input', updateSettingsViewPreview);
    elements.svThresholdWarning.addEventListener('input', updateSettingsViewPreview);
    elements.svSaveThresholds.addEventListener('click', saveSettingsFromView);
    if (elements.svSaveLimits) {
        elements.svSaveLimits.addEventListener('click', saveLimitsFromView);
    }
    if (elements.createBackupBtn) {
        elements.createBackupBtn.addEventListener('click', createBackup);
    }

    // Phase 6: Ziele & Sollwerte
    if (elements.settingsZieleBtn) {
        elements.settingsZieleBtn.addEventListener('click', openZieleManagement);
    }
    if (elements.closeZieleManagement) {
        elements.closeZieleManagement.addEventListener('click', () => hideModal('zieleManagementModal'));
    }
    if (elements.addNewZielBtn) {
        elements.addNewZielBtn.addEventListener('click', () => openZielForm(null));
    }
    if (elements.cancelZielForm) {
        elements.cancelZielForm.addEventListener('click', () => hideModal('zielFormModal'));
    }
    if (elements.confirmZielForm) {
        elements.confirmZielForm.addEventListener('click', saveZiel);
    }
    if (elements.zieleFilterQuartal) {
        elements.zieleFilterQuartal.addEventListener('change', () => {
            const val = elements.zieleFilterQuartal.value;
            loadZiele(val || null);
        });
    }

    // Frage Modal (Admin)
    elements.cancelFrage.addEventListener('click', () => hideModal('frageModal'));
    elements.confirmFrage.addEventListener('click', addFrage);

    // Edit Frage Modal (Admin)
    elements.cancelEditFrage.addEventListener('click', () => hideModal('editFrageModal'));
    elements.confirmEditFrage.addEventListener('click', saveFrage);
    elements.deleteFrage.addEventListener('click', deleteFrage);

    // Historie
    elements.refreshHistorie.addEventListener('click', loadHistorie);
    elements.resetHistorieFilters.addEventListener('click', resetAllHistorieFilters);
    elements.newFromHistorie.addEventListener('click', () => {
        resetBewertung();
        switchView('bewertung');
    });

    // Pagination
    if (elements.paginationControls) {
        elements.paginationControls.addEventListener('click', (e) => {
            const btn = e.target.closest('.pagination-btn');
            if (!btn || btn.disabled) return;
            const page = parseInt(btn.dataset.page);
            if (page && page !== state.historiePage) {
                state.historiePage = page;
                renderHistorie(state.historieData);
                // Scroll to top of table
                elements.historieTable.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }
    if (elements.historiePageSizeSelect) {
        elements.historiePageSizeSelect.addEventListener('change', (e) => {
            state.historiePageSize = parseInt(e.target.value);
            state.historiePage = 1;
            renderHistorie(state.historieData);
        });
    }

    // SEVALSystem-ID Search
    if (elements.sevalIdSearch) {
        elements.sevalIdSearch.addEventListener('input', debounce(handleSevalIdSearch, 300));
        elements.sevalIdSearch.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleSevalIdSearch();
            }
            if (e.key === 'Escape') {
                clearSevalIdSearch();
            }
        });
    }
    if (elements.sevalIdSearchClear) {
        elements.sevalIdSearchClear.addEventListener('click', clearSevalIdSearch);
    }

    // Historie View Toggle
    elements.viewToggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            switchHistorieView(btn.dataset.historieView);
            // Dropdown schließen nach Auswahl
            if (elements.viewToggleWrapper) {
                elements.viewToggleWrapper.classList.remove('open');
            }
        });
    });

    // View Toggle Dropdown Button (für kleine Fenster)
    if (elements.viewToggleDropdownBtn) {
        elements.viewToggleDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.viewToggleWrapper.classList.toggle('open');
        });
    }

    // Dropdown schließen bei Klick außerhalb
    document.addEventListener('click', (e) => {
        if (elements.viewToggleWrapper && !elements.viewToggleWrapper.contains(e.target)) {
            elements.viewToggleWrapper.classList.remove('open');
        }
    });

    // Trend Lieferant Dropdown
    if (elements.trendLieferantInput) {
        elements.trendLieferantInput.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.trendLieferantDropdown.classList.toggle('visible');
        });
    }

    // Compare Dropdowns
    if (elements.compare1Input) {
        elements.compare1Input.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.compare1Dropdown.classList.toggle('visible');
            elements.compare2Dropdown.classList.remove('visible');
        });
    }
    if (elements.compare2Input) {
        elements.compare2Input.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.compare2Dropdown.classList.toggle('visible');
            elements.compare1Dropdown.classList.remove('visible');
        });
    }

    // PDF Modal
    elements.cancelPdf.addEventListener('click', () => hideModal('pdfModal'));
    elements.downloadPdf.addEventListener('click', generatePdf);

    // Export Buttons (Trends View)
    const exportChartsPngBtn = document.getElementById('exportChartsPng');
    const exportDataCsvBtn = document.getElementById('exportDataCsv');
    if (exportChartsPngBtn) {
        exportChartsPngBtn.addEventListener('click', exportChartsToPng);
    }
    if (exportDataCsvBtn) {
        exportDataCsvBtn.addEventListener('click', exportDataToCsv);
    }
    const exportXlsxBtn = document.getElementById('exportDataXlsx');
    if (exportXlsxBtn) {
        exportXlsxBtn.addEventListener('click', exportDataToXlsx);
    }

    // Theme
    elements.themeToggle.addEventListener('click', toggleTheme);

    // About
    elements.aboutToggle.addEventListener('click', showAbout);
    elements.closeAbout.addEventListener('click', () => hideModal('aboutModal'));

    // Changelog
    if (elements.closeChangelog) {
        elements.closeChangelog.addEventListener('click', () => {
            hideModal('changelogModal');
            localStorage.setItem('changelogSeen_' + APP_VERSION, 'true');
        });
    }

    // User Management Modal (Admin)
    elements.userManagementBtn.addEventListener('click', openUserManagement);
    elements.closeUserManagement.addEventListener('click', () => hideModal('userManagementModal'));
    elements.addUserBtn.addEventListener('click', () => showModal('newUserModal'));
    elements.cancelNewUser.addEventListener('click', () => hideModal('newUserModal'));
    elements.confirmNewUser.addEventListener('click', createUser);
    elements.cancelEditUser.addEventListener('click', () => hideModal('editUserModal'));
    elements.confirmEditUser.addEventListener('click', updateUser);
    elements.deleteUserBtn.addEventListener('click', deleteUser);

    // Custom Dropdown: New User Role
    if (elements.newUserRoleInput) {
        elements.newUserRoleInput.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.newUserRoleDropdown.classList.toggle('visible');
        });
        elements.newUserRoleDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                elements.newUserRole.value = item.dataset.value;
                elements.newUserRoleInput.value = item.textContent;
                elements.newUserRoleDropdown.classList.remove('visible');
            });
        });
    }

    // Custom Dropdown: Edit User Role
    if (elements.editUserRoleInput) {
        elements.editUserRoleInput.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.editUserRoleDropdown.classList.toggle('visible');
        });
        elements.editUserRoleDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                elements.editUserRole.value = item.dataset.value;
                elements.editUserRoleInput.value = item.textContent;
                elements.editUserRoleDropdown.classList.remove('visible');
            });
        });
    }

    // Custom Dropdown: Edit User Active
    if (elements.editUserActiveInput) {
        elements.editUserActiveInput.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.editUserActiveDropdown.classList.toggle('visible');
        });
        elements.editUserActiveDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                elements.editUserActive.value = item.dataset.value;
                elements.editUserActiveInput.value = item.textContent;
                elements.editUserActiveDropdown.classList.remove('visible');
            });
        });
    }

    // Audit Log Modal (Admin)
    elements.auditLogBtn.addEventListener('click', openAuditLog);
    elements.closeAuditLog.addEventListener('click', () => hideModal('auditLogModal'));

    // Audit Modal Filter Buttons
    document.querySelectorAll('[data-audit-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-audit-filter]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            auditModalFilter = btn.dataset.auditFilter;
            filterAuditModal();
        });
    });
    if (elements.auditModalSearch) {
        elements.auditModalSearch.addEventListener('input', filterAuditModal);
    }

    // Audit Table Filter Buttons (Historie)
    document.querySelectorAll('[data-audit-table-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-audit-table-filter]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            auditTableFilter = btn.dataset.auditTableFilter;
            filterAuditTable();
        });
    });
    if (elements.auditTableSearch) {
        elements.auditTableSearch.addEventListener('input', filterAuditTable);
    }

    // Dashboard
    elements.startBewertungBtn.addEventListener('click', () => {
        switchView('bewertung');
        // Wenn es fehlende Lieferanten gibt, den ersten vorauswählen
        const firstMissing = elements.missingBannerList.querySelector('.missing-banner-item');
        if (firstMissing) {
            const lid = getLieferantIdByName(firstMissing.dataset.lieferant);
            if (lid) selectLieferant(String(lid));
        }
    });

    // KPI Card: Bewertungen → Historie mit passendem Filter
    if (elements.dashboardBewertungenCard) {
        elements.dashboardBewertungenCard.addEventListener('click', () => {
            const label = elements.dashboardQuartalLabel.textContent;

            // Prüfe ob es ein Quartal-Format ist (z.B. "Q1 2026") oder nur ein Jahr (z.B. "2026")
            if (label.startsWith('Q')) {
                // Quartal-Format: "Q1 2026" -> quartal=1, jahr=2026
                const match = label.match(/Q(\d)\s+(\d{4})/);
                if (match) {
                    switchToHistorieWithFilter({ quartal: match[1], jahr: match[2] });
                } else {
                    switchToHistorieWithFilter({});
                }
            } else if (/^\d{4}$/.test(label)) {
                // Nur Jahr: "2026" -> nur Jahr-Filter setzen
                switchToHistorieWithFilter({ jahr: label });
            } else {
                // Anderes Format (Monat, Woche, etc.) -> keine Filter
                switchToHistorieWithFilter({});
            }
        });
    }

    // KPI Card: Durchschnitt → Trends-View
    if (elements.dashboardDurchschnittCard) {
        elements.dashboardDurchschnittCard.addEventListener('click', () => {
            switchView('historie');
            // Wechsle zur Trends-Ansicht
            setTimeout(() => {
                const trendsBtn = document.querySelector('[data-historie-view="trends"]');
                if (trendsBtn) trendsBtn.click();
            }, 100);
        });
    }

    // KPI Card: Lieferanten → Lieferanten-Modal öffnen
    if (elements.dashboardLieferantenCard) {
        elements.dashboardLieferantenCard.addEventListener('click', () => {
            if (state.currentUser) {
                // Admin: Lieferanten-Modal öffnen
                elements.lieferantModal.classList.add('visible');
                renderLieferantenSelect();
            } else {
                // Nicht-Admin: Info anzeigen
                showToast('Login erforderlich für Lieferanten-Verwaltung', 'warning');
            }
        });
    }

    // KPI Card: Kritische Lieferanten → Detail-Modal
    if (elements.dashboardKritischeCard) {
        elements.dashboardKritischeCard.addEventListener('click', () => {
            showLieferantenDetailModal('kritisch');
        });
    }

    // Donut Chart Legend - klickbar für Details
    if (elements.dashboardDonutLegend) {
        elements.dashboardDonutLegend.addEventListener('click', (e) => {
            const legendItem = e.target.closest('.donut-legend-item');
            if (legendItem) {
                const color = legendItem.querySelector('.donut-legend-color');
                if (color.classList.contains('success')) {
                    showLieferantenDetailModal('gruen');
                } else if (color.classList.contains('warning')) {
                    showLieferantenDetailModal('gelb');
                } else if (color.classList.contains('danger')) {
                    showLieferantenDetailModal('rot');
                }
            }
        });
    }

    // Lieferanten Detail Modal schließen
    if (elements.closeLieferantenDetail) {
        elements.closeLieferantenDetail.addEventListener('click', () => {
            elements.lieferantenDetailModal.classList.remove('visible');
        });
    }
    if (elements.lieferantenDetailModal) {
        elements.lieferantenDetailModal.addEventListener('click', (e) => {
            if (e.target === elements.lieferantenDetailModal) {
                elements.lieferantenDetailModal.classList.remove('visible');
            }
        });
    }

    // Dashboard Timeframe Dropdown
    if (elements.dashboardTimeframeBtn) {
        elements.dashboardTimeframeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDashboardTimeframeDropdown();
        });
    }
    if (elements.dashboardTimeframeDropdown) {
        elements.dashboardTimeframeDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                selectDashboardTimeframe(item.dataset.value);
            });
        });
    }

    if (elements.dashboardRefreshBtn) {
        elements.dashboardRefreshBtn.addEventListener('click', () => {
            loadDashboard();
        });
    }

    // Date Range Modal
    if (elements.cancelDateRange) {
        elements.cancelDateRange.addEventListener('click', () => hideModal('dateRangeModal'));
    }
    if (elements.applyDateRange) {
        elements.applyDateRange.addEventListener('click', applyCustomDateRange);
    }
    if (elements.dateRangeModal) {
        elements.dateRangeModal.addEventListener('click', (e) => {
            if (e.target === elements.dateRangeModal) {
                hideModal('dateRangeModal');
            }
            // Close dropdowns when clicking outside them
            if (!elements.dateRangeStartWrapper.contains(e.target)) {
                elements.dateRangeStartDropdown.classList.remove('visible');
            }
            if (!elements.dateRangeEndWrapper.contains(e.target)) {
                elements.dateRangeEndDropdown.classList.remove('visible');
            }
        });
    }

    // Date Range Picker - Start
    if (elements.dateRangeStartInput) {
        elements.dateRangeStartInput.addEventListener('click', (e) => toggleDateRangeDropdown('start', e));
    }
    if (elements.dateRangeStartPrevMonth) {
        elements.dateRangeStartPrevMonth.addEventListener('click', (e) => {
            e.stopPropagation();
            changeDateRangeMonth('start', -1);
        });
    }
    if (elements.dateRangeStartNextMonth) {
        elements.dateRangeStartNextMonth.addEventListener('click', (e) => {
            e.stopPropagation();
            changeDateRangeMonth('start', 1);
        });
    }

    // Date Range Picker - End
    if (elements.dateRangeEndInput) {
        elements.dateRangeEndInput.addEventListener('click', (e) => toggleDateRangeDropdown('end', e));
    }
    if (elements.dateRangeEndPrevMonth) {
        elements.dateRangeEndPrevMonth.addEventListener('click', (e) => {
            e.stopPropagation();
            changeDateRangeMonth('end', -1);
        });
    }
    if (elements.dateRangeEndNextMonth) {
        elements.dateRangeEndNextMonth.addEventListener('click', (e) => {
            e.stopPropagation();
            changeDateRangeMonth('end', 1);
        });
    }

    // Vorquartal Panel
    elements.vorquartalCloseBtn.addEventListener('click', closeVorquartalPanel);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            // Nur speichern wenn Bewertungs-View aktiv ist
            const bewertungView = document.getElementById('bewertungView');
            if (bewertungView && bewertungView.classList.contains('active')) {
                saveBewertung();
            }
        }
        if (e.key === 'Escape') {
            // Schließe nur das oberste sichtbare Modal (nicht alle gleichzeitig)
            const visibleModals = document.querySelectorAll('.modal-overlay.visible');
            if (visibleModals.length > 0) {
                const modal = visibleModals[visibleModals.length - 1];
                modal.classList.remove('visible');
                // State-Callbacks zurücksetzen, um stale Actions zu verhindern
                state.confirmAction = null;
                state.promptAction = null;
                state.deleteId = null;
            }
        }
    });
}

// ============================================================================
// Date Picker
// ============================================================================
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function parseDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') {
        return new Date();
    }
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function formatDateISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateDisplay(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

function toggleDatePicker(e) {
    e.stopPropagation();
    const isVisible = elements.datePickerDropdown.classList.toggle('visible');
    if (isVisible) {
        renderDatePicker();
    }
}

function changeMonth(delta) {
    state.datePickerMonth.setMonth(state.datePickerMonth.getMonth() + delta);
    renderDatePicker();
}

function renderDatePicker() {
    const year = state.datePickerMonth.getFullYear();
    const month = state.datePickerMonth.getMonth();

    elements.datePickerTitle.textContent = `${MONTH_NAMES[month]} ${year}`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDay = (firstDay.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = lastDay.getDate();

    const today = new Date();
    const selectedISO = formatDateISO(state.selectedDate);

    let html = '';

    // Previous month days
    const prevMonth = new Date(year, month, 0);
    const prevDays = prevMonth.getDate();
    for (let i = startDay - 1; i >= 0; i--) {
        const day = prevDays - i;
        html += `<div class="date-picker-day other-month" data-date="${formatDateISO(new Date(year, month - 1, day))}">${day}</div>`;
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateISO = formatDateISO(date);
        const isToday = date.toDateString() === today.toDateString();
        const isSelected = dateISO === selectedISO;

        let classes = 'date-picker-day';
        if (isToday) classes += ' today';
        if (isSelected) classes += ' selected';

        html += `<div class="${classes}" data-date="${dateISO}">${day}</div>`;
    }

    // Next month days
    const totalCells = Math.ceil((startDay + daysInMonth) / 7) * 7;
    const remaining = totalCells - (startDay + daysInMonth);
    for (let day = 1; day <= remaining; day++) {
        html += `<div class="date-picker-day other-month" data-date="${formatDateISO(new Date(year, month + 1, day))}">${day}</div>`;
    }

    elements.datePickerDays.innerHTML = html;

    // Add click listeners
    elements.datePickerDays.querySelectorAll('.date-picker-day').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            selectDate(el.dataset.date);
        });
    });
}

function selectDate(dateISO) {
    state.selectedDate = parseDate(dateISO);
    state.datePickerMonth = new Date(state.selectedDate);
    updateDateDisplay();
    elements.datePickerDropdown.classList.remove('visible');

    // Update save button state (enables if date changed from loaded evaluation)
    updateProgress();

    // Vorquartal-Maßnahmen neu laden wenn Lieferant bereits ausgewählt
    if (elements.lieferantSelect.value) {
        // Reset dismissed flag bei Datumswechsel
        state.vorquartalPanelDismissed = false;
        // Panel sofort verstecken während neue Daten geladen werden
        state.vorquartalMassnahmen = null;
        hideVorquartalPanel();
        loadVorquartalMassnahmen();
    }
}

function updateDateDisplay() {
    elements.datumInput.value = formatDateDisplay(state.selectedDate);
}

// ============================================================================
// Views
// ============================================================================
function switchView(viewName) {
    // Settings requires login
    if (viewName === 'settings' && !state.currentUser) {
        showToast('Bitte zuerst anmelden', 'warning');
        return;
    }

    // Update sidebar nav buttons
    elements.navBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    // Update sidebar footer settings button active state
    if (elements.sidebarSettingsBtn) {
        elements.sidebarSettingsBtn.classList.toggle('active', viewName === 'settings');
    }

    // Update header title
    const titles = { dashboard: 'Dashboard', bewertung: 'Bewertung', historie: 'Historie', settings: 'Einstellungen' };
    if (elements.headerTitle) {
        elements.headerTitle.textContent = titles[viewName] || viewName;
    }

    // View transition
    const currentView = document.querySelector('.view.active');
    const nextView = document.getElementById(viewName + 'View');

    if (currentView && currentView !== nextView) {
        currentView.classList.add('view-exit');
        currentView.addEventListener('animationend', function handler() {
            currentView.classList.remove('active', 'view-exit');
            currentView.removeEventListener('animationend', handler);
            if (nextView) {
                nextView.classList.add('active', 'view-enter');
                nextView.addEventListener('animationend', function handler2() {
                    nextView.classList.remove('view-enter');
                    nextView.removeEventListener('animationend', handler2);
                });
            }
        });
    } else if (nextView && !nextView.classList.contains('active')) {
        nextView.classList.add('active', 'view-enter');
        nextView.addEventListener('animationend', function handler() {
            nextView.classList.remove('view-enter');
            nextView.removeEventListener('animationend', handler);
        });
    }

    // Nur Daten laden wenn eingeloggt
    if (state.currentUser) {
        if (viewName === 'dashboard') {
            loadDashboard();
        } else if (viewName === 'historie') {
            loadHistorie();
        } else if (viewName === 'settings') {
            populateSettingsView();
        }
    }
}

// Switch to Historie with pre-applied filters
function switchToHistorieWithFilter(filters = {}) {
    // Filter VOR dem View-Wechsel setzen (Elemente sind immer im DOM)
    if (filters.lieferant) {
        elements.historieFilter.value = filters.lieferant;
        elements.historieFilterInput.value = filters.lieferant;
    }
    if (filters.quartal) {
        elements.historieQuartalFilter.value = filters.quartal;
        elements.historieQuartalFilterInput.value = 'Q' + filters.quartal;
    }
    if (filters.jahr) {
        elements.historieJahrFilter.value = filters.jahr;
        elements.historieJahrFilterInput.value = filters.jahr;
    }
    // switchView('historie') ruft loadHistorie() mit den gesetzten Filtern auf
    switchView('historie');
}

// ============================================================================
// Render Functions
// ============================================================================
function renderLieferantenSelect() {
    // Custom dropdown items
    if (state.lieferanten.length === 0) {
        elements.lieferantDropdown.innerHTML = '<div class="custom-dropdown-empty">Keine Lieferanten</div>';
    } else {
        elements.lieferantDropdown.innerHTML = state.lieferanten
            .map(l => `<div class="custom-dropdown-item" data-value="${l.id}">${escapeHtml(l.name)}</div>`)
            .join('');

        // Add click listeners for dropdown items
        elements.lieferantDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                selectLieferant(item.dataset.value);
            });
        });
    }

    // Don't auto-select - let user choose (placeholder will show)

    // Historie filter dropdown
    renderHistorieLieferantDropdown();

    // Lieferant list in modal with delete and rename buttons
    if (state.lieferanten.length === 0) {
        elements.lieferantListContainer.innerHTML = '<p class="empty-list">Keine Lieferanten vorhanden</p>';
    } else {
        elements.lieferantListContainer.innerHTML = state.lieferanten
            .map(l => `
                <div class="lieferant-item">
                    <span>${escapeHtml(l.name)}</span>
                    <div style="display:flex;gap:4px;">
                        <button class="icon-btn small rename-lieferant-btn" data-id="${l.id}" data-name="${escapeHtml(l.name)}" title="Umbenennen">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        <button class="icon-btn small delete-lieferant-btn" data-id="${l.id}" data-name="${escapeHtml(l.name)}" title="Löschen">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3,6 5,6 21,6"/>
                                <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6M8,6V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `)
            .join('');

        // Add event listeners for rename buttons
        elements.lieferantListContainer.querySelectorAll('.rename-lieferant-btn').forEach(btn => {
            btn.addEventListener('click', () => renameLieferant(parseInt(btn.dataset.id), btn.dataset.name));
        });

        // Add event listeners for delete buttons
        elements.lieferantListContainer.querySelectorAll('.delete-lieferant-btn').forEach(btn => {
            btn.addEventListener('click', () => deleteLieferant(parseInt(btn.dataset.id), btn.dataset.name));
        });
    }
}

function selectLieferant(value) {
    elements.lieferantSelect.value = value; // Stores ID
    const lieferantObj = state.lieferanten.find(l => String(l.id) === String(value));
    elements.lieferantInput.value = lieferantObj ? lieferantObj.name : value;
    elements.lieferantDropdown.classList.remove('visible');
    // Trigger Vorquartal-Maßnahmen laden
    loadVorquartalMassnahmen();
}

function renderSeTeamList() {
    // SE-Team filter in Historie (custom dropdown)
    renderHistorieSeTeamDropdown();

    // SE-Team list in modal with delete and rename buttons
    if (state.seTeams.length === 0) {
        elements.seTeamListContainer.innerHTML = '<p class="empty-list">Keine SE-Teams vorhanden</p>';
    } else {
        elements.seTeamListContainer.innerHTML = state.seTeams
            .map(t => `
                <div class="se-team-item">
                    <span>${escapeHtml(t.name)}</span>
                    <div style="display:flex;gap:4px;">
                        <button class="icon-btn small rename-se-team-btn" data-id="${t.id}" data-name="${escapeHtml(t.name)}" title="Umbenennen">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        <button class="icon-btn small delete-se-team-btn" data-id="${t.id}" data-name="${escapeHtml(t.name)}" title="Löschen">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3,6 5,6 21,6"/>
                                <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6M8,6V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `)
            .join('');

        // Add event listeners for rename buttons
        elements.seTeamListContainer.querySelectorAll('.rename-se-team-btn').forEach(btn => {
            btn.addEventListener('click', () => renameSeTeam(parseInt(btn.dataset.id), btn.dataset.name));
        });

        // Add event listeners for delete buttons
        elements.seTeamListContainer.querySelectorAll('.delete-se-team-btn').forEach(btn => {
            btn.addEventListener('click', () => deleteSeTeam(parseInt(btn.dataset.id), btn.dataset.name));
        });
    }
}

function renderSeTeamDropdown(filter = '') {
    const filtered = state.seTeams.filter(t =>
        t.name.toLowerCase().includes(filter.toLowerCase())
    );

    if (filtered.length === 0) {
        elements.seTeamDropdown.innerHTML = filter
            ? '<div class="custom-dropdown-empty">Keine Treffer</div>'
            : '<div class="custom-dropdown-empty">Keine SE-Teams</div>';
    } else {
        elements.seTeamDropdown.innerHTML = filtered
            .map(t => `<div class="custom-dropdown-item" data-value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div>`)
            .join('');

        // Add click listeners for dropdown items
        elements.seTeamDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                elements.seTeamInput.value = item.dataset.value;
                elements.seTeamDropdown.classList.remove('visible');
            });
        });
    }
}

function renderHistorieLieferantDropdown() {
    let html = '<div class="custom-dropdown-item" data-value="">Alle</div>';
    html += state.lieferanten
        .map(l => `<div class="custom-dropdown-item" data-value="${escapeHtml(l.name)}">${escapeHtml(l.name)}</div>`)
        .join('');

    elements.historieFilterDropdown.innerHTML = html;

    // Add click listeners for dropdown items
    elements.historieFilterDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const value = item.dataset.value;
            elements.historieFilter.value = value;
            elements.historieFilterInput.value = value || 'Alle';
            elements.historieFilterDropdown.classList.remove('visible');
            loadHistorie();
        });
    });
}

function renderHistorieSeTeamDropdown() {
    let html = '<div class="custom-dropdown-item" data-value="">Alle</div>';
    html += state.seTeams
        .map(t => `<div class="custom-dropdown-item" data-value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div>`)
        .join('');

    elements.historieSeTeamFilterDropdown.innerHTML = html;

    // Add click listeners for dropdown items
    elements.historieSeTeamFilterDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const value = item.dataset.value;
            elements.historieSeTeamFilter.value = value;
            elements.historieSeTeamFilterInput.value = value || 'Alle';
            elements.historieSeTeamFilterDropdown.classList.remove('visible');
            loadHistorie();
        });
    });
}

function renderHistorieJahrDropdown(availableYears = []) {
    // Use available years from data, or default to current year
    const currentYear = new Date().getFullYear();
    let years = [];

    if (availableYears.length > 0) {
        // Use years from actual data
        years = [...new Set(availableYears)].sort((a, b) => b - a);
    } else {
        // Default: current year and next year
        years = [currentYear + 1, currentYear];
    }

    // Filter invalid years (must be a reasonable range)
    years = years.filter(y => y >= 2000 && y <= currentYear + 1);

    // Always include current year if not present
    if (!years.includes(currentYear)) {
        years.push(currentYear);
        years.sort((a, b) => b - a);
    }

    let html = '<div class="custom-dropdown-item" data-value="">Alle</div>';
    html += years
        .map(y => `<div class="custom-dropdown-item" data-value="${y}">${y}</div>`)
        .join('');

    elements.historieJahrFilterDropdown.innerHTML = html;

    // Add click listeners for dropdown items
    elements.historieJahrFilterDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const value = item.dataset.value;
            elements.historieJahrFilter.value = value;
            elements.historieJahrFilterInput.value = value || 'Alle';
            elements.historieJahrFilterDropdown.classList.remove('visible');
            loadHistorie();
        });
    });
}

function renderHistorieQuartalDropdown() {
    const quartale = [
        { value: '1', label: 'Q1' },
        { value: '2', label: 'Q2' },
        { value: '3', label: 'Q3' },
        { value: '4', label: 'Q4' }
    ];

    let html = '<div class="custom-dropdown-item" data-value="">Alle</div>';
    html += quartale
        .map(q => `<div class="custom-dropdown-item" data-value="${q.value}">${q.label}</div>`)
        .join('');

    elements.historieQuartalFilterDropdown.innerHTML = html;

    // Add click listeners for dropdown items
    elements.historieQuartalFilterDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const value = item.dataset.value;
            elements.historieQuartalFilter.value = value;
            elements.historieQuartalFilterInput.value = value ? quartale.find(q => q.value === value).label : 'Alle';
            elements.historieQuartalFilterDropdown.classList.remove('visible');
            loadHistorie();
        });
    });
}

function closeAllHistorieDropdowns() {
    elements.historieFilterDropdown.classList.remove('visible');
    elements.historieSeTeamFilterDropdown.classList.remove('visible');
    elements.historieJahrFilterDropdown.classList.remove('visible');
    elements.historieQuartalFilterDropdown.classList.remove('visible');
}

function resetAllHistorieFilters() {
    // Reset pagination
    state.historiePage = 1;
    // Reset all filter values
    elements.historieFilter.value = '';
    elements.historieFilterInput.value = 'Alle';
    elements.historieSeTeamFilter.value = '';
    elements.historieSeTeamFilterInput.value = 'Alle';
    elements.historieJahrFilter.value = '';
    elements.historieJahrFilterInput.value = 'Alle';
    elements.historieQuartalFilter.value = '';
    elements.historieQuartalFilterInput.value = 'Alle';

    // Clear SEVALSystem-ID search
    if (elements.sevalIdSearch) {
        elements.sevalIdSearch.value = '';
        elements.sevalIdSearch.classList.remove('has-value');
    }
    removeSearchResultInfo();

    // Reset Compare Lieferanten
    state.selectedCompare1 = null;
    state.selectedCompare2 = null;
    if (elements.compare1Filter) elements.compare1Filter.value = '';
    if (elements.compare1Input) elements.compare1Input.value = 'Lieferant wählen';
    if (elements.compare2Filter) elements.compare2Filter.value = '';
    if (elements.compare2Input) elements.compare2Input.value = 'Lieferant wählen';
    resetCompareCard(1);
    resetCompareCard(2);

    // Close all dropdowns
    closeAllHistorieDropdowns();

    // Reload Historie
    loadHistorie();
}

// ============================================================================
// SEVALSystem-ID Search
// ============================================================================

// Debounce helper function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Handle SEVALSystem-ID search
function handleSevalIdSearch() {
    const searchInput = elements.sevalIdSearch;
    if (!searchInput) return;

    const searchValue = searchInput.value.trim();

    // Update has-value class for clear button visibility
    if (searchValue) {
        searchInput.classList.add('has-value');
    } else {
        searchInput.classList.remove('has-value');
        removeSearchResultInfo();
        removeSearchHighlights();
        return;
    }

    // Extract ID from search (handles "SEVALSystem-24", "sevalsystem-24", "24", etc.)
    let searchId = searchValue;
    const sevalMatch = searchValue.match(/sevalsys[- ]?(\d+)/i);
    if (sevalMatch) {
        searchId = sevalMatch[1];
    }

    // Try to parse as number
    const idNumber = parseInt(searchId, 10);
    if (isNaN(idNumber)) {
        showSearchNotFound(searchValue);
        return;
    }

    // Search in historieData
    const found = state.historieData.find(h => h.id === idNumber);

    if (found) {
        showSearchResult(found);
        highlightSearchResult(found.id);
    } else {
        showSearchNotFound(searchValue);
    }
}

// Clear SEVALSystem-ID search
function clearSevalIdSearch() {
    if (elements.sevalIdSearch) {
        elements.sevalIdSearch.value = '';
        elements.sevalIdSearch.classList.remove('has-value');
        elements.sevalIdSearch.focus();
    }
    removeSearchResultInfo();
    removeSearchHighlights();
}

// Show search result info banner
function showSearchResult(entry) {
    removeSearchResultInfo();

    const infoHtml = `
        <div class="search-result-info" id="searchResultInfo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12,6 12,12 16,14"/>
            </svg>
            <span>Gefunden: <span class="found-id">SEVALSystem-${entry.id}</span> — ${escapeHtml(entry.lieferant)} — ${formatDate(entry.datum)} — ${entry.ergebnis.toFixed(1)}%</span>
            <button class="jump-btn" data-id="${entry.id}">Anzeigen</button>
        </div>
    `;

    // Insert after historie-controls
    const controlsContainer = document.querySelector('.historie-controls');
    if (controlsContainer) {
        controlsContainer.insertAdjacentHTML('afterend', infoHtml);
        // Add event listener for jump button
        const jumpBtn = document.querySelector('#searchResultInfo .jump-btn');
        if (jumpBtn) {
            jumpBtn.addEventListener('click', () => jumpToSearchResult(parseInt(jumpBtn.dataset.id)));
        }
    }
}

// Show "not found" info
function showSearchNotFound(searchValue) {
    removeSearchResultInfo();
    removeSearchHighlights();

    const infoHtml = `
        <div class="search-result-info" id="searchResultInfo" style="background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); color: var(--danger);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <span>Keine Bewertung gefunden für "${escapeHtml(searchValue)}"</span>
        </div>
    `;

    const controlsContainer = document.querySelector('.historie-controls');
    if (controlsContainer) {
        controlsContainer.insertAdjacentHTML('afterend', infoHtml);
    }
}

// Remove search result info banner
function removeSearchResultInfo() {
    const existing = document.getElementById('searchResultInfo');
    if (existing) {
        existing.remove();
    }
}

// Highlight search result in table/timeline
function highlightSearchResult(id) {
    removeSearchHighlights();

    // Highlight in table view
    const tableRow = document.querySelector(`#historieBody tr[data-id="${id}"]`);
    if (tableRow) {
        tableRow.classList.add('search-highlight');
        tableRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Highlight in timeline view
    const timelineCard = document.querySelector(`.timeline-card[data-id="${id}"]`);
    if (timelineCard) {
        timelineCard.classList.add('search-highlight');
        timelineCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// Remove all search highlights
function removeSearchHighlights() {
    document.querySelectorAll('.search-highlight').forEach(el => {
        el.classList.remove('search-highlight');
    });
}

// Jump to search result and load it
function jumpToSearchResult(id) {
    loadBewertung(id);
}

function renderQuestions() {
    const groups = {};
    state.fragen.forEach(f => {
        if (!groups[f.gruppe]) groups[f.gruppe] = [];
        groups[f.gruppe].push(f);
    });

    let html = '';
    let groupIndex = 0;
    let questionNumber = 1; // Running counter for sequential numbering
    const isAdmin = hasAdminAccess();

    for (const [groupName, fragen] of Object.entries(groups)) {
        const isCollapsed = !state.groupsExpanded && groupIndex > 0;
        const groupComment = state.kommentare[groupName] || '';
        const escapedGroupName = escapeHtml(groupName);
        html += `
            <div class="question-group">
                <div class="group-header${isCollapsed ? ' collapsed' : ''}" data-group="${groupIndex}">
                    <h3>${escapedGroupName}</h3>
                    <svg class="group-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6,9 12,15 18,9"/>
                    </svg>
                </div>
                <div class="group-content">
                    ${fragen.map(f => renderQuestion(f, isAdmin, questionNumber++)).join('')}
                    <button class="comment-toggle" data-group="${escapedGroupName}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6,9 12,15 18,9"/>
                        </svg>
                        Kommentar
                    </button>
                    <div class="comment-area" data-group="${escapedGroupName}">
                        <textarea placeholder="Kommentar eingeben..." data-group="${escapedGroupName}">${escapeHtml(groupComment)}</textarea>
                    </div>
                </div>
            </div>
        `;
        groupIndex++;
    }

    // Add "New Question" button for admin
    if (isAdmin) {
        html += `
            <div class="admin-controls">
                <button class="btn btn-secondary add-frage-btn" id="addFrageBtn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Neue Frage hinzufügen
                </button>
            </div>
        `;
    }

    elements.questionsContainer.innerHTML = html;

    // Add event listeners for questions
    document.querySelectorAll('.option-btn').forEach(btn => {
        btn.addEventListener('click', () => selectOption(btn));
    });

    // Group toggle
    document.querySelectorAll('.group-header').forEach(header => {
        header.addEventListener('click', () => {
            header.classList.toggle('collapsed');
            updateToggleButtonState();
        });
    });

    // Comment toggle
    document.querySelectorAll('.comment-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const groupIndex = toggle.dataset.group;
            const area = document.querySelector(`.comment-area[data-group="${groupIndex}"]`);
            toggle.classList.toggle('open');
            area.classList.toggle('visible');
        });
    });

    // Comment input
    document.querySelectorAll('.comment-area textarea').forEach(textarea => {
        textarea.addEventListener('input', () => {
            state.kommentare[textarea.dataset.group] = textarea.value;
        });
    });

    // Admin: Add frage button
    const addFrageBtn = document.getElementById('addFrageBtn');
    if (addFrageBtn) {
        addFrageBtn.addEventListener('click', showAddFrageModal);
    }

    // Admin: Edit frage buttons
    document.querySelectorAll('.edit-frage-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const frageId = parseInt(btn.dataset.frageId);
            showEditFrageModal(frageId);
        });
    });

    updateToggleButtonState();
}

function renderQuestion(frage, isAdmin = false, displayNumber = null) {
    const value = state.antworten[frage.id];
    const editBtn = isAdmin ? `
        <button class="icon-btn small edit-frage-btn" data-frage-id="${frage.id}" title="Frage bearbeiten">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
        </button>
    ` : '';
    const isNew = frage.is_custom && frage.erstellt_am && (Date.now() - new Date(frage.erstellt_am).getTime()) < 14 * 24 * 60 * 60 * 1000;
    const customBadge = isNew ? '<span class="custom-badge">Neu</span>' : '';
    const questionNum = displayNumber !== null ? displayNumber : (frage.index + 1);

    return `
        <div class="question">
            <div class="question-text">
                <span class="question-number">${questionNum}.</span>
                <span class="question-label">${escapeHtml(frage.text)}</span>
                ${customBadge}
                ${editBtn}
            </div>
            <div class="question-options">
                <button class="option-btn${value === -1 ? ' selected' : ''}" data-frage-id="${frage.id}" data-value="-1">–</button>
                <button class="option-btn${value === 2 ? ' selected' : ''}" data-frage-id="${frage.id}" data-value="2"><span class="option-icon">✓</span> Erfüllt</button>
                <button class="option-btn${value === 1 ? ' selected' : ''}" data-frage-id="${frage.id}" data-value="1"><span class="option-icon">≈</span> Teilweise</button>
                <button class="option-btn${value === 0 ? ' selected' : ''}" data-frage-id="${frage.id}" data-value="0"><span class="option-icon">✗</span> Nicht erfüllt</button>
            </div>
        </div>
    `;
}

function selectOption(btn) {
    const frageId = parseInt(btn.dataset.frageId);
    const value = parseInt(btn.dataset.value);

    state.antworten[frageId] = value;

    // Update UI
    const options = btn.parentElement.querySelectorAll('.option-btn');
    options.forEach(o => o.classList.remove('selected'));
    btn.classList.add('selected');

    updateProgress();
    updateResult();
}

function updateProgress() {
    const values = Object.values(state.antworten);
    const answered = values.filter(a => a !== -1).length;
    const total = values.length;
    const percent = total > 0 ? (answered / total) * 100 : 0;

    elements.progressFill.style.width = percent + '%';
    elements.progressText.textContent = `${answered}/${total}`;

    // Controlling darf keine neuen Bewertungen speichern
    if (!canSaveBewertung()) {
        elements.saveBtn.disabled = true;
        elements.saveBtn.title = 'Nur Mitglieder und Administratoren können Bewertungen erstellen';
        elements.saveBtn.classList.remove('btn-disabled-loaded');
        return;
    }

    // Enable/disable save button based on all questions answered AND loaded state
    if (answered === total && total > 0) {
        // Check if this is a loaded evaluation with unchanged date
        if (state.isLoadedBewertung && !hasDateChanged()) {
            elements.saveBtn.disabled = true;
            elements.saveBtn.title = 'Datum ändern um als neue Bewertung zu speichern';
            elements.saveBtn.classList.add('btn-disabled-loaded');
        } else {
            elements.saveBtn.disabled = false;
            elements.saveBtn.title = 'Bewertung speichern';
            elements.saveBtn.classList.remove('btn-disabled-loaded');
        }
    } else {
        elements.saveBtn.disabled = true;
        elements.saveBtn.title = `Bitte alle ${total} Fragen beantworten (${total - answered} offen)`;
        elements.saveBtn.classList.remove('btn-disabled-loaded');
    }
}

// Check if the selected date differs from the loaded evaluation's date
function hasDateChanged() {
    if (!state.loadedBewertungDate) return true;
    const currentDate = formatDateISO(state.selectedDate);
    return currentDate !== state.loadedBewertungDate;
}

// Reset loaded evaluation state (for new evaluations)
function resetLoadedState() {
    state.isLoadedBewertung = false;
    state.loadedBewertungDate = null;
}

function updateResult() {
    let totalScore = 0;
    let totalMaxScore = 0;
    let answeredCount = 0;
    let totalQuestions = 0;

    // Filter out deleted questions first
    const activeQuestions = state.fragen.filter(f => f); // Assuming state.fragen might contain nulls if not cleaned properly, or just iterate all
    totalQuestions = activeQuestions.length;

    activeQuestions.forEach(f => {
        const answer = state.antworten[f.id];
        const weight = f.gewichtung || 1; // Default weight 1 if missing

        if (answer !== undefined && answer !== -1) {
            answeredCount++;
            
            // Max points for this question = 100 * weight
            totalMaxScore += 100 * weight;

            if (answer === 2) { // Erfüllt
                totalScore += 100 * weight;
            } else if (answer === 1) { // Teilweise
                totalScore += 50 * weight;
            }
            // answer 0 (Nicht erfüllt) adds 0 to score
        }
    });

    const percentage = totalMaxScore > 0 ? (totalScore / totalMaxScore) * 100 : 0;
    
    // Update UI
    elements.resultValue.textContent = percentage.toFixed(1) + '%';
    elements.resultValue.className = 'result-value ' + getResultClass(percentage);
    
    elements.progressText.textContent = `${answeredCount}/${totalQuestions}`;
    const progressPercent = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0;
    elements.progressFill.style.width = progressPercent + '%';
}

// ============================================================================
// Toggle Groups
// ============================================================================
function toggleAllGroups() {
    const headers = document.querySelectorAll('.group-header');
    const allCollapsed = Array.from(headers).every(h => h.classList.contains('collapsed'));

    headers.forEach(header => {
        if (allCollapsed) {
            header.classList.remove('collapsed');
        } else {
            header.classList.add('collapsed');
        }
    });

    state.groupsExpanded = allCollapsed;
    updateToggleButtonState();
}

function updateToggleButtonState() {
    const headers = document.querySelectorAll('.group-header');
    const allCollapsed = Array.from(headers).every(h => h.classList.contains('collapsed'));

    elements.toggleGroupsText.textContent = allCollapsed ? 'Ausklappen' : 'Einklappen';
    elements.toggleGroupsIcon.style.transform = allCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
}

// ============================================================================
// Maßnahmen Panel
// ============================================================================

function toggleMassnahmenPanel() {
    const isVisible = elements.massnahmenPanel.classList.contains('visible');
    if (isVisible) {
        closeMassnahmenPanel();
    } else {
        openMassnahmenPanel();
    }
}

function openMassnahmenPanel() {
    elements.massnahmenPanel.classList.add('visible');
    renderPendingMassnahmen();
    setTimeout(() => {
        if (elements.massnahmeDesc) elements.massnahmeDesc.focus();
    }, 100);
}

function closeMassnahmenPanel() {
    elements.massnahmenPanel.classList.remove('visible');
}

function updateMassnahmenIndicator() {
    const hasContent = state.pendingMassnahmen.length > 0;
    if (hasContent) {
        elements.massnahmenIndicator.classList.add('has-content');
        elements.massnahmenIndicator.textContent = state.pendingMassnahmen.length;
    } else {
        elements.massnahmenIndicator.classList.remove('has-content');
        elements.massnahmenIndicator.textContent = '';
    }
}

function addPendingMassnahme() {
    const desc = elements.massnahmeDesc.value.trim();
    if (!desc) {
        elements.massnahmeDesc.focus();
        return;
    }
    state.pendingMassnahmen.push({
        beschreibung: desc,
        verantwortlich: elements.massnahmeVerantw.value.trim() || null,
        faellig_am: elements.massnahmeFaellig.value || null,
    });
    elements.massnahmeDesc.value = '';
    elements.massnahmeVerantw.value = '';
    elements.massnahmeFaellig.value = '';
    elements.massnahmeDesc.focus();
    renderPendingMassnahmen();
    updateMassnahmenIndicator();
}

function removePendingMassnahme(index) {
    state.pendingMassnahmen.splice(index, 1);
    renderPendingMassnahmen();
    updateMassnahmenIndicator();
}

function renderPendingMassnahmen() {
    if (!elements.massnahmenListe) return;
    if (state.pendingMassnahmen.length === 0) {
        elements.massnahmenListe.innerHTML = '<div class="massnahmen-empty">Noch keine Maßnahmen hinzugefügt</div>';
        return;
    }
    elements.massnahmenListe.innerHTML = state.pendingMassnahmen.map((m, i) => {
        const verantw = m.verantwortlich ? `<span class="massnahme-verantw-tag">${escapeHtml(m.verantwortlich)}</span>` : '';
        const faellig = m.faellig_am ? `<span class="massnahme-date-tag">${formatDate(m.faellig_am)}</span>` : '';
        return `<div class="massnahme-item">
            <span class="massnahme-desc" title="${escapeHtml(m.beschreibung)}">${escapeHtml(m.beschreibung)}</span>
            <span class="massnahme-meta">${verantw}${faellig}</span>
            <button class="massnahme-remove" data-index="${i}" title="Entfernen">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        </div>`;
    }).join('');
}

// Generic auto-resize for textarea elements
function autoResizeTextarea(textarea, maxHeight = 120) {
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    // Set height to scrollHeight (content height)
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = newHeight + 'px';
}

// Auto-resize Bestellnummer textarea (main form)
function autoResizeBestellnummer() {
    autoResizeTextarea(elements.bestellnummerInput, 120);
}

// ============================================================================
// Actions
// ============================================================================
async function saveBewertung() {
    if (state.isSaving) return;
    state.isSaving = true;
    elements.saveBtn.disabled = true;
    try {
        await _saveBewertungInner();
    } finally {
        state.isSaving = false;
        // Restore button state based on current progress/permissions
        updateProgress();
    }
}

async function _saveBewertungInner() {
    if (!canSaveBewertung()) {
        showToast('Neue Bewertungen können nur von Mitgliedern oder Administratoren erstellt werden.', 'warning');
        return;
    }

    const answered = Object.values(state.antworten).filter(a => a !== -1);

    if (answered.length === 0) {
        showError('Bitte mindestens eine Frage beantworten!');
        return;
    }

    const seTeam = elements.seTeamInput.value.trim();
    if (!seTeam) {
        showError('Bitte ein SE-Team eingeben!');
        elements.seTeamInput.focus();
        return;
    }

    const lieferantId = parseInt(elements.lieferantSelect.value);
    if (!lieferantId) {
        showError('Bitte einen Lieferanten auswählen!');
        return;
    }
    const lieferant = getLieferantNameById(lieferantId) || elements.lieferantInput.value;
    const seTeamId = getSeTeamIdByName(seTeam) || null;

    // Calculate weighted result
    let totalScore = 0;
    let totalMaxScore = 0;

    // Filter out deleted questions first
    const activeQuestions = state.fragen.filter(f => f); 

    activeQuestions.forEach(f => {
        const answer = state.antworten[f.id];
        const weight = f.gewichtung || 1;

        if (answer !== undefined && answer !== -1) {
            totalMaxScore += 100 * weight;

            if (answer === 2) { // Erfüllt
                totalScore += 100 * weight;
            } else if (answer === 1) { // Teilweise
                totalScore += 50 * weight;
            }
        }
    });

    const ergebnis = totalMaxScore > 0 ? (totalScore / totalMaxScore) * 100 : 0;

    // Maßnahmen: Strukturierte Maßnahmen als Zusammenfassung in Freitext-Feld
    let massnahmen = '';
    if (state.pendingMassnahmen.length > 0) {
        massnahmen = state.pendingMassnahmen.map(m => {
            let line = '- ' + m.beschreibung;
            if (m.verantwortlich) line += ` (${m.verantwortlich})`;
            if (m.faellig_am) line += ` [bis ${m.faellig_am}]`;
            return line;
        }).join('\n');
    }

    // Wenn Vorquartals-Maßnahmen vorhanden waren, Status dokumentieren
    // Status wird IMMER gespeichert wenn es Vorquartal-Maßnahmen gab (unabhängig ob Panel sichtbar)
    if (state.vorquartalMassnahmen) {
        const umgesetzt = elements.vorquartalUmgesetzt.checked;
        const statusText = umgesetzt
            ? '[VQ-Maßnahmen umgesetzt]'
            : '[VQ-Maßnahmen nicht umgesetzt]';

        // Nur hinzufügen, wenn nicht bereits vorhanden
        if (!massnahmen.includes('[VQ-Maßnahmen')) {
            massnahmen = massnahmen ? `${statusText}\n\n${massnahmen}` : statusText;
        }
    }

    const datum = formatDateISO(state.selectedDate);

    const bewertung = {
        id: null,
        lieferant_id: lieferantId,
        lieferant: lieferant,
        se_team_id: seTeamId,
        se_team: seTeam,
        datum: datum,
        antworten: state.antworten,
        kommentare: state.kommentare,
        ergebnis: ergebnis,
        bestellnummer: elements.bestellnummerInput.value.trim(),
        massnahmen: massnahmen
    };

    // Duplikat-Check: Prüfe ob im selben Quartal bereits eine Bewertung existiert
    if (!state._skipDuplicateCheck) {
        try {
            const duplicate = await invoke('check_duplicate_bewertung_cmd', {
                lieferantId: lieferantId,
                seTeamId: seTeamId,
                datum: datum
            });

            if (duplicate) {
                const monat = parseInt(datum.split('-')[1]);
                const quartal = Math.ceil(monat / 3);
                const jahr = datum.split('-')[0];
                const dupDatum = formatDate(duplicate.datum);

                showConfirmDialog(
                    'Duplikat erkannt',
                    `Für "${lieferant}" (${seTeam}) existiert bereits eine Bewertung in Q${quartal}/${jahr} vom ${dupDatum} mit ${duplicate.ergebnis.toFixed(1)}% (SEVALSystem-${duplicate.id}). Trotzdem eine neue Bewertung speichern?`,
                    async () => {
                        state._skipDuplicateCheck = true;
                        try {
                            await saveBewertung();
                        } finally {
                            state._skipDuplicateCheck = false;
                        }
                    },
                    'Trotzdem speichern'
                );
                return;
            }
        } catch (e) {
            // Bei Fehler im Duplikat-Check trotzdem speichern lassen
            console.warn('Duplikat-Check fehlgeschlagen:', e);
        }
    }
    state._skipDuplicateCheck = false;

    try {
        const bewertungId = await invoke('speichere_bewertung_cmd', { bewertung });

        // Strukturierte Maßnahmen speichern
        if (state.pendingMassnahmen.length > 0) {
            for (const m of state.pendingMassnahmen) {
                try {
                    await invoke('create_massnahme_cmd', {
                        massnahme: {
                            bewertung_id: bewertungId,
                            beschreibung: m.beschreibung,
                            verantwortlich: m.verantwortlich,
                            faellig_am: m.faellig_am,
                        }
                    });
                } catch (e) {
                    console.warn('Fehler beim Speichern einer Maßnahme:', e);
                }
            }
        }

        // Show success modal with confetti
        elements.successMessage.textContent = 'Bewertung erfolgreich abgeschlossen';
        showModal('successModal');
        showConfetti();

        // Phase 6: Ziel-Vergleich Toast
        try {
            const quartal = getQuartalFromDate(bewertung.datum);
            if (quartal) {
                const ziel = bewertung.lieferant_id ? await invoke('get_ziel_fuer_lieferant_cmd', {
                    lieferantId: bewertung.lieferant_id,
                    quartal: quartal
                }) : null;
                if (ziel) {
                    const diff = bewertung.ergebnis - ziel.zielwert;
                    const sign = diff >= 0 ? '+' : '';
                    if (diff >= 0) {
                        showToast(`Ziel erreicht! Ist: ${bewertung.ergebnis.toFixed(1)}% | Soll: ${ziel.zielwert.toFixed(1)}% (${sign}${diff.toFixed(1)}%)`, 'success');
                    } else if (diff >= -5) {
                        showToast(`Ziel knapp verfehlt. Ist: ${bewertung.ergebnis.toFixed(1)}% | Soll: ${ziel.zielwert.toFixed(1)}% (${diff.toFixed(1)}%)`, 'warning');
                    } else {
                        showToast(`Ziel verfehlt. Ist: ${bewertung.ergebnis.toFixed(1)}% | Soll: ${ziel.zielwert.toFixed(1)}% (${diff.toFixed(1)}%)`, 'error');
                    }
                }
            }
        } catch (e) {
            // Silent fail — Ziel-Check ist nicht kritisch
        }
    } catch (e) {
        showStatus('Fehler beim Speichern: ' + e, true);
    }
}

function resetBewertung(silent = false) {
    // Reset antworten - ID-based object
    state.antworten = {};
    state.fragen.forEach(f => {
        state.antworten[f.id] = -1;
    });

    // Reset kommentare - group-based object
    state.kommentare = {};

    state.selectedDate = new Date();
    state.datePickerMonth = new Date();

    // Reset loaded evaluation state (enables save button for new evaluations)
    resetLoadedState();

    elements.seTeamInput.value = '';
    elements.lieferantSelect.value = '';
    elements.lieferantInput.value = '';
    elements.bestellnummerInput.value = '';
    autoResizeBestellnummer();
    elements.massnahmenInput.value = '';
    state.pendingMassnahmen = [];

    // Close Maßnahmen panel and reset indicator
    closeMassnahmenPanel();
    updateMassnahmenIndicator();

    // Reset Vorquartal panel
    hideVorquartalPanel();
    state.vorquartalMassnahmen = null;
    state.vorquartalPanelDismissed = false;

    renderQuestions();
    updateProgress();
    updateResult();
    updateDateDisplay();

    if (!silent) {
        showStatus('Bewertung zurückgesetzt', false);
    }
}

async function addLieferant() {
    const name = elements.newLieferantInput.value.trim();

    if (!name) return;

    try {
        await invoke('add_lieferant', { name });
        await loadLieferanten();
        // Neuen Lieferant per ID auswählen (nicht per Name)
        const newLieferant = state.lieferanten.find(l => l.name === name);
        if (newLieferant) {
            selectLieferant(String(newLieferant.id));
        }
        elements.newLieferantInput.value = '';
        showStatus(`Lieferant "${name}" hinzugefügt`, false);
    } catch (e) {
        showStatus('Fehler beim Hinzufügen: ' + e, true);
    }
}

async function addSeTeam() {
    const name = elements.newSeTeamInput.value.trim();

    if (!name) return;

    try {
        await invoke('add_se_team', { name });
        await loadSeTeams();
        elements.seTeamInput.value = name;
        elements.newSeTeamInput.value = '';
        showStatus(`SE-Team "${name}" hinzugefügt`, false);
    } catch (e) {
        showStatus('Fehler beim Hinzufügen: ' + e, true);
    }
}

function showConfirmDialog(title, message, onConfirm, buttonText = 'Bestätigen', isDanger = false) {
    elements.confirmTitle.textContent = title;
    elements.confirmMessage.textContent = message;
    state.confirmAction = onConfirm;

    // Update button text and style
    const confirmBtn = document.getElementById('confirmConfirm');
    confirmBtn.textContent = buttonText;
    confirmBtn.className = isDanger ? 'btn btn-danger' : 'btn btn-primary';

    showModal('confirmModal');
}

function showPromptDialog(title, placeholder, defaultValueOrConfirm, onConfirmOrUndefined) {
    elements.promptTitle.textContent = title;
    // Support both (title, placeholder, onConfirm) and (title, placeholder, defaultValue, onConfirm)
    if (typeof defaultValueOrConfirm === 'function') {
        elements.promptInput.placeholder = placeholder || '';
        elements.promptInput.value = '';
        state.promptAction = defaultValueOrConfirm;
    } else {
        elements.promptInput.placeholder = placeholder || '';
        elements.promptInput.value = defaultValueOrConfirm || '';
        state.promptAction = onConfirmOrUndefined;
    }
    showModal('promptModal');
    // Focus input after modal is shown
    setTimeout(() => { elements.promptInput.focus(); elements.promptInput.select(); }, 100);
}

async function deleteSeTeam(id, name) {
    if (!hasAdminAccess()) {
        showToast('SE-Teams können nur von Administratoren gelöscht werden.', 'warning');
        return;
    }

    // Verknüpfte Bewertungen zählen
    let count = 0;
    try {
        count = await invoke('count_bewertungen_for_se_team_cmd', { id });
    } catch (e) {
        console.warn('Fehler beim Zählen verknüpfter Bewertungen:', e);
    }

    const warnung = count > 0
        ? `Das SE-Team "${name}" hat ${count} verknüpfte Bewertung${count !== 1 ? 'en' : ''}. Diese werden mit allen Maßnahmen und Zielen kaskadiert gelöscht. Wirklich löschen?`
        : `Möchten Sie das SE-Team "${name}" wirklich löschen?`;

    showConfirmDialog(
        'SE-Team löschen',
        warnung,
        async () => {
            try {
                await invoke('delete_se_team', { id });
                await loadSeTeams();
                showStatus(`SE-Team "${name}" gelöscht`, false);
            } catch (e) {
                showStatus('Fehler beim Löschen: ' + e, true);
            }
        },
        'Löschen',
        true
    );
}

async function deleteLieferant(id, name) {
    if (!hasAdminAccess()) {
        showToast('Lieferanten können nur von Administratoren gelöscht werden.', 'warning');
        return;
    }

    // Verknüpfte Bewertungen zählen
    let count = 0;
    try {
        count = await invoke('count_bewertungen_for_lieferant_cmd', { id });
    } catch (e) {
        console.warn('Fehler beim Zählen verknüpfter Bewertungen:', e);
    }

    const warnung = count > 0
        ? `Der Lieferant "${name}" hat ${count} verknüpfte Bewertung${count !== 1 ? 'en' : ''}. Diese werden mit allen Maßnahmen und Zielen kaskadiert gelöscht. Wirklich löschen?`
        : `Möchten Sie den Lieferanten "${name}" wirklich löschen?`;

    showConfirmDialog(
        'Lieferant löschen',
        warnung,
        async () => {
            try {
                await invoke('delete_lieferant', { id });
                await loadLieferanten();
                showStatus(`Lieferant "${name}" gelöscht`, false);
            } catch (e) {
                showStatus('Fehler beim Löschen: ' + e, true);
            }
        },
        'Löschen',
        true
    );
}

// Phase 7: Rename-Funktionen
async function renameLieferant(id, currentName) {
    if (!hasAdminAccess()) {
        showToast('Nur Administratoren können Lieferanten umbenennen.', 'warning');
        return;
    }
    showPromptDialog('Lieferant umbenennen', `Neuer Name für "${currentName}":`, currentName, async (newName) => {
        if (!newName || newName.trim() === '' || newName.trim() === currentName) return;
        try {
            await invoke('rename_lieferant_cmd', { id, newName: newName.trim() });
            await loadLieferanten();
            showStatus(`Lieferant umbenannt: "${currentName}" → "${newName.trim()}"`, false);
        } catch (e) {
            showStatus('Fehler beim Umbenennen: ' + e, true);
        }
    });
}

async function renameSeTeam(id, currentName) {
    if (!hasAdminAccess()) {
        showToast('Nur Administratoren können SE-Teams umbenennen.', 'warning');
        return;
    }
    showPromptDialog('SE-Team umbenennen', `Neuer Name für "${currentName}":`, currentName, async (newName) => {
        if (!newName || newName.trim() === '' || newName.trim() === currentName) return;
        try {
            await invoke('rename_se_team_cmd', { id, newName: newName.trim() });
            await loadSeTeams();
            showStatus(`SE-Team umbenannt: "${currentName}" → "${newName.trim()}"`, false);
        } catch (e) {
            showStatus('Fehler beim Umbenennen: ' + e, true);
        }
    });
}

// ============================================================================
// Historie
// ============================================================================
async function loadHistorie() {
    // Bei neuen Daten immer auf Seite 1 zurücksetzen
    state.historiePage = 1;
    // Generation counter: bei parallelen Aufrufen gewinnt immer der neueste
    const thisGeneration = ++state.historieLoadGeneration;
    state.isLoadingHistorie = true;

    const lieferantFilter = elements.historieFilter.value || null;
    const seTeamFilter = elements.historieSeTeamFilter.value || null;
    const jahrFilter = elements.historieJahrFilter.value || null;
    const quartalFilter = elements.historieQuartalFilter.value || null;

    try {
        // Load all historie - one API call, filter everything client-side
        const allHistorie = await invoke('lade_historie_cmd', {
            lieferantFilter: null,
            seTeamFilter: null
        });

        // Falls ein neuerer Aufruf gestartet wurde, Ergebnis verwerfen
        if (thisGeneration !== state.historieLoadGeneration) return;

        // Extract unique years and update dropdown
        const availableYears = allHistorie.map(h => parseInt(h.datum.split('-')[0]));
        renderHistorieJahrDropdown(availableYears);

        // Apply all filters client-side
        let historie = allHistorie;

        if (lieferantFilter) {
            historie = historie.filter(h => h.lieferant === lieferantFilter);
        }

        if (seTeamFilter) {
            historie = historie.filter(h => h.se_team === seTeamFilter);
        }

        if (jahrFilter) {
            historie = historie.filter(h => {
                const jahr = h.datum.split('-')[0];
                return jahr === jahrFilter;
            });
        }

        if (quartalFilter) {
            historie = historie.filter(h => {
                const monat = parseInt(h.datum.split('-')[1]);
                const quartal = Math.ceil(monat / 3);
                return quartal === parseInt(quartalFilter);
            });
        }

        // Cache data for all views
        state.historieData = historie;

        // Render based on current view
        renderHistorieView();
    } catch (e) {
        if (thisGeneration === state.historieLoadGeneration) {
            showStatus('Fehler beim Laden der Historie: ' + e, true);
        }
    } finally {
        if (thisGeneration === state.historieLoadGeneration) {
            state.isLoadingHistorie = false;
        }
    }
}

function renderHistorie(historie) {
    if (historie.length === 0) {
        elements.historieTable.style.display = 'none';
        elements.historieEmpty.classList.add('visible');
        elements.historieCount.textContent = '0 Einträge';
        if (elements.historiePagination) elements.historiePagination.classList.add('hidden');
        return;
    }

    elements.historieTable.style.display = 'table';
    elements.historieEmpty.classList.remove('visible');

    // Pagination berechnen
    const totalItems = historie.length;
    const pageSize = state.historiePageSize;
    const totalPages = Math.ceil(totalItems / pageSize);

    // Sicherstellen dass aktuelle Seite gültig ist
    if (state.historiePage > totalPages) state.historiePage = totalPages;
    if (state.historiePage < 1) state.historiePage = 1;

    const startIdx = (state.historiePage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalItems);
    const pageData = historie.slice(startIdx, endIdx);

    // Count-Anzeige mit Pagination-Info
    if (totalPages > 1) {
        elements.historieCount.textContent = `${startIdx + 1}–${endIdx} von ${totalItems} Einträgen`;
    } else {
        elements.historieCount.textContent = `${totalItems} Einträge`;
    }

    const isAdmin = hasAdminAccess();
    const canEdit = canEditBewertung();

    elements.historieBody.innerHTML = pageData.map(h => {
        const resultClass = h.ergebnis >= state.settings.threshold_success ? 'success' : h.ergebnis >= state.settings.threshold_warning ? 'warning' : 'danger';
        const datumFormatted = formatDate(h.datum);
        const editDenied = canEdit ? '' : 'data-permission-denied="edit"';
        const editClass = canEdit ? '' : 'btn-permission-denied';
        const editTitle = canEdit ? 'Bearbeiten' : 'Nur für Admin/Controlling verfügbar';
        const deleteDenied = isAdmin ? '' : 'data-permission-denied="delete"';
        const deleteClass = isAdmin ? '' : 'btn-permission-denied';
        const deleteTitle = isAdmin ? 'Bewertung löschen' : 'Nur für Admin verfügbar';

        const hasOpenMassnahmen = h.has_open_massnahmen === true;
        const isResolution = h.is_resolution === true;

        let massnahmenBadge = '';
        let rowClass = '';

        // Strukturierte Maßnahmen-Badge (Phase 2)
        if (h.massnahmen_total > 0) {
            if (h.massnahmen_offen > 0) {
                massnahmenBadge = `<span class="massnahme-status-badge offen" title="${h.massnahmen_offen} offen, ${h.massnahmen_erledigt} erledigt">${h.massnahmen_offen}/${h.massnahmen_total}</span> `;
                rowClass = 'has-massnahmen';
            } else {
                massnahmenBadge = `<span class="massnahme-status-badge erledigt" title="Alle ${h.massnahmen_total} erledigt">✓ ${h.massnahmen_total}</span> `;
                rowClass = 'massnahmen-resolved';
            }
        } else if (isResolution) {
            massnahmenBadge = `<span title="Maßnahmen umgesetzt ✓" style="color: var(--success); margin-right: 4px;">✓</span>`;
            rowClass = 'massnahmen-resolved';
        } else if (hasOpenMassnahmen) {
            massnahmenBadge = `<span title="Offene Maßnahmen" style="color: var(--warning); margin-right: 4px;">⚠</span>`;
            rowClass = 'has-massnahmen';
        }

        // Vorquartal-Vergleich
        let vorquartalHtml = '-';
        if (h.vorquartal_diff !== null && h.vorquartal_diff !== undefined) {
            const diff = h.vorquartal_diff;
            const diffClass = diff > 0 ? 'trend-up' : diff < 0 ? 'trend-down' : 'trend-neutral';
            const diffSign = diff > 0 ? '+' : '';
            const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
            vorquartalHtml = `<span class="${diffClass}">${arrow} ${diffSign}${diff.toFixed(1)}%</span>`;
        }

        return `
            <tr data-id="${h.id}" class="${rowClass}">
                <td class="historie-id">SEVALSystem-${h.id}</td>
                <td>${escapeHtml(datumFormatted)}</td>
                <td>${massnahmenBadge}${escapeHtml(h.lieferant)}</td>
                <td>${escapeHtml(h.se_team) || '-'}</td>
                <td class="historie-result ${resultClass}">${h.ergebnis.toFixed(1)}%</td>
                <td class="historie-trend">${vorquartalHtml}</td>
                <td class="historie-actions">
                    <button class="btn btn-secondary btn-load" data-id="${h.id}" title="Laden">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                            <polyline points="7,10 12,15 17,10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        <span class="btn-text">Laden</span>
                    </button>
                    <button class="btn btn-warning btn-edit ${editClass}" data-id="${h.id}" ${editDenied} title="${editTitle}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        <span class="btn-text">Bearbeiten</span>
                    </button>
                    <button class="btn btn-primary btn-pdf" data-id="${h.id}" title="Als PDF exportieren">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                            <polyline points="14,2 14,8 20,8"/>
                            <line x1="12" y1="18" x2="12" y2="12"/>
                            <polyline points="9,15 12,12 15,15"/>
                        </svg>
                        <span class="btn-text">PDF</span>
                    </button>
                    <button class="btn btn-danger btn-delete ${deleteClass}" data-id="${h.id}" ${deleteDenied} title="${deleteTitle}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                            <polyline points="3,6 5,6 21,6"/>
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            <line x1="10" y1="11" x2="10" y2="17"/>
                            <line x1="14" y1="11" x2="14" y2="17"/>
                        </svg>
                        <span class="btn-text">Löschen</span>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    // Pagination rendern
    renderHistoriePagination(totalItems, totalPages);
}

function renderHistoriePagination(totalItems, totalPages) {
    if (!elements.historiePagination) return;

    // Pagination nur anzeigen wenn mehr als eine Seite
    if (totalPages <= 1) {
        elements.historiePagination.classList.add('hidden');
        return;
    }

    elements.historiePagination.classList.remove('hidden');

    // Info-Text
    const startIdx = (state.historiePage - 1) * state.historiePageSize;
    const endIdx = Math.min(startIdx + state.historiePageSize, totalItems);
    elements.paginationInfo.textContent = `Seite ${state.historiePage} von ${totalPages}`;

    // Seiten-Buttons generieren
    const current = state.historiePage;
    let buttons = '';

    // Zurück-Button
    buttons += `<button class="pagination-btn" data-page="${current - 1}" ${current === 1 ? 'disabled' : ''} title="Vorherige Seite">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
            <polyline points="15,18 9,12 15,6"/>
        </svg>
    </button>`;

    // Seiten-Buttons mit Ellipsis-Logik
    const pages = getPaginationPages(current, totalPages);
    for (const p of pages) {
        if (p === '...') {
            buttons += `<span class="pagination-ellipsis">...</span>`;
        } else {
            buttons += `<button class="pagination-btn ${p === current ? 'active' : ''}" data-page="${p}">${p}</button>`;
        }
    }

    // Vor-Button
    buttons += `<button class="pagination-btn" data-page="${current + 1}" ${current === totalPages ? 'disabled' : ''} title="Nächste Seite">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
            <polyline points="9,18 15,12 9,6"/>
        </svg>
    </button>`;

    elements.paginationControls.innerHTML = buttons;
}

function getPaginationPages(current, total) {
    // Kompakte Darstellung: immer erste, letzte, und 1-2 Seiten um die aktuelle
    if (total <= 7) {
        return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages = [];
    pages.push(1);

    if (current > 3) pages.push('...');

    const rangeStart = Math.max(2, current - 1);
    const rangeEnd = Math.min(total - 1, current + 1);

    for (let i = rangeStart; i <= rangeEnd; i++) {
        pages.push(i);
    }

    if (current < total - 2) pages.push('...');

    pages.push(total);

    return pages;
}

// ============================================================================
// Historie View Switching
// ============================================================================
function switchHistorieView(viewName) {
    if (state.currentHistorieView === viewName) return;

    state.currentHistorieView = viewName;

    // Update toggle buttons
    elements.viewToggleBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.historieView === viewName);
    });

    // Update Dropdown-Button Icon (für kleine Fenster)
    if (elements.viewToggleDropdownBtn) {
        const activeBtn = document.querySelector(`.view-toggle-btn[data-historie-view="${viewName}"]`);
        if (activeBtn) {
            const svg = activeBtn.querySelector('svg').cloneNode(true);
            const currentSvg = elements.viewToggleDropdownBtn.querySelector('svg:first-child');
            if (currentSvg) {
                currentSvg.replaceWith(svg);
            }
        }
    }

    // Hide all views
    const views = [
        elements.historieTableView,
        elements.historieTimelineView,
        elements.historieTrendsView,
        elements.historieCompareView,
        elements.historieAuditView
    ];
    views.forEach(v => v && v.classList.remove('active'));

    // Show selected view
    switch (viewName) {
        case 'table':
            elements.historieTableView.classList.add('active');
            break;
        case 'timeline':
            elements.historieTimelineView.classList.add('active');
            renderTimeline();
            break;
        case 'trends':
            elements.historieTrendsView.classList.add('active');
            renderTrendsView();
            break;
        case 'compare':
            elements.historieCompareView.classList.add('active');
            renderCompareView();
            break;
        case 'audit':
            elements.historieAuditView.classList.add('active');
            renderAuditView();
            break;
    }
}

function renderHistorieView() {
    // Render the appropriate view based on current selection
    renderHistorie(state.historieData);

    if (state.currentHistorieView === 'timeline') {
        renderTimeline();
    } else if (state.currentHistorieView === 'trends') {
        renderTrendsView();
    } else if (state.currentHistorieView === 'compare') {
        renderCompareView();
    } else if (state.currentHistorieView === 'audit') {
        renderAuditView();
    }
}

// ============================================================================
// Audit Log View
// ============================================================================
let auditTableFilter = 'all';

function filterAuditTable() {
    const searchText = (elements.auditTableSearch ? elements.auditTableSearch.value : '').toLowerCase();
    const rows = elements.auditTableBody.querySelectorAll('tr');
    let visibleCount = 0;
    rows.forEach(row => {
        const matchesAction = auditTableFilter === 'all' || row.dataset.action === auditTableFilter;
        const matchesSearch = !searchText || row.textContent.toLowerCase().includes(searchText);
        const visible = matchesAction && matchesSearch;
        row.classList.toggle('audit-hidden', !visible);
        if (visible) visibleCount++;
    });
    if (elements.auditTableCount) {
        elements.auditTableCount.textContent = visibleCount + ' von ' + rows.length + ' Einträgen';
    }
    // Scroll nach oben zurücksetzen damit gefilterte Ergebnisse sichtbar sind
    const container = document.querySelector('.audit-table-container');
    if (container) container.scrollTop = 0;
}

async function renderAuditView() {
    try {
        const entries = await invoke('get_audit_log', { limit: 500 });

        // Reset filters
        auditTableFilter = 'all';
        if (elements.auditTableSearch) elements.auditTableSearch.value = '';
        document.querySelectorAll('[data-audit-table-filter]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.auditTableFilter === 'all');
        });

        if (!entries || entries.length === 0) {
            elements.auditTableBody.innerHTML = '';
            elements.auditEmpty.classList.add('visible');
            if (elements.auditTableCount) elements.auditTableCount.textContent = '';
            return;
        }

        elements.auditEmpty.classList.remove('visible');

        const actionLabels = {
            'CREATE': 'Erstellt',
            'UPDATE': 'Geändert',
            'DELETE': 'Gelöscht',
            'LOGIN_SUCCESS': 'Login erfolgreich',
            'LOGIN_FAILED': 'Login fehlgeschlagen',
            'LOGOUT': 'Abgemeldet',
            'VIEW': 'Angesehen',
            'EXPORT_PDF': 'PDF exportiert',
            'EXPORT_CSV': 'CSV exportiert',
            'EXPORT_IMAGE': 'Bild exportiert',
            'SWITCH_DB': 'Datenbank gewechselt',
            'FACTORY_RESET_START': 'Factory Reset gestartet',
            'FACTORY_RESET_COMPLETE': 'Factory Reset abgeschlossen',
            'FACTORY_RESET_DENIED': 'Factory Reset verweigert'
        };

        const entityLabels = {
            'session': 'Sitzung',
            'bewertung': 'Bewertung',
            'lieferant': 'Lieferant',
            'se_team': 'SE-Team',
            'frage': 'Frage',
            'user': 'Benutzer',
            'user_password': 'Passwort',
            'settings': 'Einstellungen',
            'database': 'Datenbank',
            'system': 'System',
            'export': 'Export',
            'audit_log': 'Audit-Log',
            'backup': 'Backup'
        };

        const actionClasses = {
            'CREATE': 'status-success',
            'UPDATE': 'status-warning',
            'DELETE': 'status-danger',
            'LOGIN_SUCCESS': 'status-success',
            'LOGOUT': 'status-warning',
            'VIEW': 'status-neutral',
            'EXPORT_PDF': 'status-neutral',
            'EXPORT_CSV': 'status-neutral',
            'EXPORT_IMAGE': 'status-neutral',
            'SWITCH_DB': 'status-warning',
            'FACTORY_RESET_START': 'status-danger',
            'FACTORY_RESET_COMPLETE': 'status-danger'
        };

        elements.auditTableBody.innerHTML = entries.map(entry => {
            const actionLabel = actionLabels[entry.action] || entry.action;
            const entityLabel = entityLabels[entry.entity_type] || entry.entity_type;
            const actionClass = actionClasses[entry.action] || '';
            const successIcon = entry.success ? '' : ' ⚠️';

            return `
            <tr data-action="${entry.action}">
                <td class="audit-cell-time">${formatTimestamp(entry.timestamp)}</td>
                <td class="audit-cell-user">${escapeHtml(entry.username)}${successIcon}</td>
                <td class="audit-cell-action"><span class="audit-action ${actionClass}">${escapeHtml(actionLabel)}</span><span class="audit-entity">${escapeHtml(entityLabel)}</span></td>
                <td class="audit-cell-details">${escapeHtml(entry.details || '')}</td>
            </tr>
            `;
        }).join('');

        filterAuditTable();
    } catch (e) {
        console.error('Error loading audit log:', e);
        elements.auditTableBody.innerHTML = '';
        elements.auditEmpty.classList.add('visible');
    }
}

// ============================================================================
// Timeline View
// ============================================================================
function renderTimeline() {
    const historie = state.historieData;

    if (!historie || historie.length === 0) {
        elements.timelineContainer.innerHTML = '';
        elements.timelineEmpty.classList.add('visible');
        return;
    }

    elements.timelineEmpty.classList.remove('visible');

    // Sort by date descending (newest first)
    const sorted = [...historie].sort((a, b) => new Date(b.datum) - new Date(a.datum));

    const isAdmin = hasAdminAccess();
    const canEdit = canEditBewertung();

    elements.timelineContainer.innerHTML = sorted.map(h => {
        const date = new Date(h.datum);
        const day = date.getDate();
        const month = MONTH_NAMES[date.getMonth()].substring(0, 3);
        const year = date.getFullYear();
        const resultClass = h.ergebnis >= state.settings.threshold_success ? 'success' : h.ergebnis >= state.settings.threshold_warning ? 'warning' : 'danger';
        const editDenied = canEdit ? '' : 'data-permission-denied="edit"';
        const editClass = canEdit ? '' : 'btn-permission-denied';
        const editTitle = canEdit ? 'Bearbeiten' : 'Nur für Admin/Controlling verfügbar';
        const deleteDenied = isAdmin ? '' : 'data-permission-denied="delete"';
        const deleteClass = isAdmin ? '' : 'btn-permission-denied';

        // Vorquartal-Vergleich für Timeline
        let trendHtml = '';
        if (h.vorquartal_diff !== null && h.vorquartal_diff !== undefined) {
            const diff = h.vorquartal_diff;
            const diffClass = diff > 0 ? 'trend-up' : diff < 0 ? 'trend-down' : 'trend-neutral';
            const diffSign = diff > 0 ? '+' : '';
            const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
            trendHtml = `<span class="timeline-trend ${diffClass}">${arrow} ${diffSign}${diff.toFixed(1)}%</span>`;
        }

        // Maßnahmen-Indikator
        const hasOpenMassnahmen = h.has_open_massnahmen === true;
        const isResolution = h.is_resolution === true;

        let massnahmenBadge = '';
        let massnahmenClass = '';

        if (h.massnahmen_total > 0) {
            if (h.massnahmen_offen > 0) {
                massnahmenBadge = `<span class="massnahme-status-badge offen" title="${h.massnahmen_offen} offen, ${h.massnahmen_erledigt} erledigt">${h.massnahmen_offen}/${h.massnahmen_total}</span> `;
                massnahmenClass = 'has-massnahmen';
            } else {
                massnahmenBadge = `<span class="massnahme-status-badge erledigt" title="Alle ${h.massnahmen_total} erledigt">✓ ${h.massnahmen_total}</span> `;
                massnahmenClass = 'massnahmen-resolved';
            }
        } else if (isResolution) {
            massnahmenBadge = `
                <span class="timeline-massnahmen-badge resolved" title="Maßnahmen umgesetzt ✓">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                    </svg>
                </span>
            `;
            massnahmenClass = 'massnahmen-resolved';
        } else if (hasOpenMassnahmen) {
            massnahmenBadge = `
                <span class="timeline-massnahmen-badge open" title="Offene Maßnahmen">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2L1 21h22L12 2zm0 3.99L19.53 19H4.47L12 5.99zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
                    </svg>
                </span>
            `;
            massnahmenClass = 'has-massnahmen';
        }

        return `
            <div class="timeline-item">
                <div class="timeline-date">
                    <div class="timeline-date-day">${day}</div>
                    <div class="timeline-date-month">${month} ${year}</div>
                </div>
                <div class="timeline-marker">
                    <div class="timeline-dot ${resultClass}"></div>
                </div>
                <div class="timeline-card ${massnahmenClass}" data-id="${h.id}" data-expanded="false">
                    <div class="timeline-card-header" data-id="${h.id}">
                        <span class="timeline-card-title">${massnahmenBadge}${escapeHtml(h.lieferant)}</span>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            ${trendHtml}
                            <span class="timeline-card-score ${resultClass}">${h.ergebnis.toFixed(1)}%</span>
                            <svg class="timeline-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6,9 12,15 18,9"/>
                            </svg>
                        </div>
                    </div>
                    <div class="timeline-card-body">
                        <div class="timeline-card-item">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                                <circle cx="9" cy="7" r="4"/>
                                <path d="M23 21v-2a4 4 0 00-3-3.87"/>
                                <path d="M16 3.13a4 4 0 010 7.75"/>
                            </svg>
                            ${escapeHtml(h.se_team) || '-'}
                        </div>
                    </div>
                    <div class="timeline-card-expanded-content" id="timeline-expanded-${h.id}">
                        <div class="timeline-card-loading">Lade Details...</div>
                    </div>
                    <div class="timeline-card-actions">
                        <button class="btn btn-secondary btn-load" data-id="${h.id}" title="Laden">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                                <polyline points="7,10 12,15 17,10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            <span class="btn-text">Laden</span>
                        </button>
                        <button class="btn btn-warning btn-edit ${editClass}" data-id="${h.id}" ${editDenied} title="${editTitle}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                            <span class="btn-text">Bearbeiten</span>
                        </button>
                        <button class="btn btn-primary btn-pdf" data-id="${h.id}" title="PDF exportieren">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                                <polyline points="14,2 14,8 20,8"/>
                            </svg>
                            <span class="btn-text">PDF</span>
                        </button>
                        <button class="btn btn-danger btn-delete ${deleteClass}" data-id="${h.id}" ${deleteDenied} title="Löschen">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                                <polyline points="3,6 5,6 21,6"/>
                                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                            <span class="btn-text">Löschen</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    // Event-Listener via Event-Delegation in setupEventListeners()
}

// Toggle Timeline Card Expansion (Accordion behavior)
async function toggleTimelineCard(event, id) {
    event.stopPropagation();

    const card = document.querySelector(`.timeline-card[data-id="${id}"]`);
    if (!card) return;

    const isExpanded = card.classList.contains('expanded');

    // Accordion: Close all other cards
    document.querySelectorAll('.timeline-card.expanded').forEach(otherCard => {
        if (otherCard !== card) {
            otherCard.classList.remove('expanded');
            otherCard.dataset.expanded = 'false';
        }
    });

    if (isExpanded) {
        // Collapse this card
        card.classList.remove('expanded');
        card.dataset.expanded = 'false';
    } else {
        // Expand this card
        card.classList.add('expanded');
        card.dataset.expanded = 'true';

        // Load details if not already loaded
        const expandedContent = document.getElementById(`timeline-expanded-${id}`);
        if (expandedContent && expandedContent.querySelector('.timeline-card-loading')) {
            await loadTimelineCardDetails(id);
        }
    }
}

// Load details for expanded timeline card
async function loadTimelineCardDetails(id) {
    const expandedContent = document.getElementById(`timeline-expanded-${id}`);
    if (!expandedContent) return;

    try {
        const bewertung = await invoke('lade_bewertung_cmd', { id });

        if (!bewertung) {
            expandedContent.innerHTML = '<p class="timeline-card-no-comment">Keine Details verfügbar</p>';
            return;
        }

        // Calculate category scores from antworten
        const categoryScores = calculateCategoryScores(bewertung.antworten);

        // Separate into strengths and weaknesses
        const strengths = categoryScores.filter(c => c.percentage >= state.settings.threshold_success);
        const weaknesses = categoryScores.filter(c => c.percentage < state.settings.threshold_success);

        // Get first comment
        const kommentare = bewertung.kommentare || {};
        const firstComment = Object.values(kommentare).find(k => k && k.trim());

        let html = '';

        // Strengths section
        if (strengths.length > 0) {
            html += `
                <div class="timeline-card-section">
                    <div class="timeline-card-section-title success">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20,6 9,17 4,12"/>
                        </svg>
                        Stärken
                    </div>
                    ${strengths.map(s => `
                        <div class="timeline-category-item">
                            <span class="timeline-category-name">${escapeHtml(s.name)}</span>
                            <span class="timeline-category-score success">${s.percentage.toFixed(1)}%</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        // Weaknesses section
        if (weaknesses.length > 0) {
            html += `
                <div class="timeline-card-section">
                    <div class="timeline-card-section-title ${weaknesses.some(w => w.percentage < state.settings.threshold_warning) ? 'danger' : 'warning'}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        Verbesserungspotenzial
                    </div>
                    ${weaknesses.map(w => {
                        const scoreClass = w.percentage >= state.settings.threshold_warning ? 'warning' : 'danger';
                        return `
                            <div class="timeline-category-item">
                                <span class="timeline-category-name">${escapeHtml(w.name)}</span>
                                <span class="timeline-category-score ${scoreClass}">${w.percentage.toFixed(1)}%</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        // Comment section
        html += `
            <div class="timeline-card-section">
                <div class="timeline-card-section-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                    </svg>
                    Bemerkung
                </div>
                ${firstComment
                    ? `<div class="timeline-card-comment">"${escapeHtml(firstComment)}"</div>`
                    : '<p class="timeline-card-no-comment">Keine Bemerkung vorhanden</p>'
                }
            </div>
        `;

        expandedContent.innerHTML = html;

    } catch (e) {
        console.error('Error loading timeline card details:', e);
        expandedContent.innerHTML = '<p class="timeline-card-no-comment">Fehler beim Laden der Details</p>';
    }
}

// Calculate category scores from antworten
function calculateCategoryScores(antworten) {
    if (!antworten || !state.fragen || state.fragen.length === 0) {
        return [];
    }

    // Group questions by gruppe
    const groups = {};
    state.fragen.forEach(f => {
        if (!groups[f.gruppe]) {
            groups[f.gruppe] = { sum: 0, max: 0, count: 0 };
        }

        const answer = antworten[f.id];
        const weight = f.gewichtung || 1;

        if (answer !== undefined && answer !== -1) {
            groups[f.gruppe].sum += answer * weight; // 0, 1, 2 * weight
            groups[f.gruppe].max += 2 * weight;      // Max points = 2 * weight
        }
        groups[f.gruppe].count++;
    });

    // Calculate percentages
    const scores = [];
    for (const [name, data] of Object.entries(groups)) {
        if (data.max > 0) {
            const percentage = (data.sum / data.max) * 100;
            scores.push({ name, percentage });
        }
    }

    // Sort by percentage descending
    return scores.sort((a, b) => b.percentage - a.percentage);
}

// ============================================================================
// Trends View
// ============================================================================
function renderTrendsView() {
    const historie = state.historieData;

    // Render lieferant dropdown for trends
    renderTrendLieferantDropdown();

    if (!historie || historie.length === 0) {
        elements.trendsStats.innerHTML = '';
        elements.trendsEmpty.classList.add('visible');
        destroyCharts();
        return;
    }

    elements.trendsEmpty.classList.remove('visible');

    // Render charts
    renderTrendLineChart();
    renderTrendBarChart();
    renderTrendsStats();
    renderKategorieTrendChart();
    renderSeTeamVergleich();
}

function renderTrendLieferantDropdown() {
    const lieferanten = [...new Set(state.historieData.map(h => h.lieferant))].sort();

    let html = '<div class="custom-dropdown-item" data-value="">Alle Lieferanten</div>';
    html += lieferanten.map(l => `
        <div class="custom-dropdown-item${state.selectedTrendLieferant === l ? ' selected' : ''}" data-value="${escapeHtml(l)}">${escapeHtml(l)}</div>
    `).join('');

    elements.trendLieferantDropdown.innerHTML = html;
    elements.trendLieferantInput.value = state.selectedTrendLieferant || 'Alle Lieferanten';

    // Add click handlers
    elements.trendLieferantDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            state.selectedTrendLieferant = item.dataset.value || null;
            elements.trendLieferantInput.value = item.dataset.value || 'Alle Lieferanten';
            elements.trendLieferantDropdown.classList.remove('visible');
            renderTrendLineChart();
            renderTrendsStats();
            renderKategorieTrendChart();
        });
    });
}

// Color palette for multi-line chart
const LIEFERANT_COLORS = {
    '__average__': { get color() { return getAccentColor(); }, name: 'Durchschnitt aller' },
    '_colors_': ['#10b981', '#3b82f6', '#ef4444', '#a855f7', '#14b8a6', '#ec4899', '#06b6d4', '#f43f5e']
};

async function renderTrendLineChart() {
    const historie = state.historieData;
    if (!historie || historie.length === 0) return;

    // Initialize multi-select dropdown
    renderMultiSelectDropdown();

    // Get all unique dates across all data
    const allDates = [...new Set(historie.map(h => h.datum))].sort();

    // Build datasets based on selected lieferanten
    const datasets = [];
    let colorIndex = 0;

    state.multiSelectLieferanten.forEach(key => {
        let dataByDate, label, color;

        if (key === '__average__') {
            // Calculate average across all lieferanten for each date
            dataByDate = {};
            allDates.forEach(date => {
                const entriesOnDate = historie.filter(h => h.datum === date);
                if (entriesOnDate.length > 0) {
                    dataByDate[date] = entriesOnDate.reduce((sum, h) => sum + h.ergebnis, 0) / entriesOnDate.length;
                }
            });
            label = 'Durchschnitt aller';
            color = LIEFERANT_COLORS['__average__'].color;
        } else {
            // Get data for specific lieferant
            const lieferantData = historie.filter(h => h.lieferant === key);
            dataByDate = {};
            lieferantData.forEach(h => {
                dataByDate[h.datum] = h.ergebnis;
            });
            label = key;
            color = LIEFERANT_COLORS['_colors_'][colorIndex % LIEFERANT_COLORS['_colors_'].length];
            colorIndex++;
        }

        // Create dataset
        const values = allDates.map(date => dataByDate[date] !== undefined ? dataByDate[date].toFixed(1) : null);

        datasets.push({
            label: label,
            data: values,
            borderColor: color,
            backgroundColor: color + '15',
            borderWidth: key === '__average__' ? 3 : 2,
            fill: false,
            tension: 0.4,
            pointBackgroundColor: color,
            pointRadius: 4,
            pointHoverRadius: 6,
            spanGaps: true // Connect points even if there are gaps
        });
    });

    // Phase 6: Ziellinie hinzufügen wenn genau 1 Lieferant ausgewählt (nicht __average__)
    const realSuppliers = state.multiSelectLieferanten.filter(k => k !== '__average__');
    if (realSuppliers.length === 1) {
        try {
            const realSupplierId = getLieferantIdByName(realSuppliers[0]);
            const ziele = realSupplierId ? await invoke('get_ziele_cmd', { lieferantId: realSupplierId }) : [];
            if (ziele && ziele.length > 0) {
                // Map jedes Datum zum passenden Quartal-Zielwert
                const zielValues = allDates.map(dateStr => {
                    const q = getQuartalFromDate(dateStr);
                    const match = ziele.find(z => z.quartal === q);
                    return match ? match.zielwert : null;
                });

                // Nur hinzufügen wenn mindestens ein Zielwert vorhanden
                if (zielValues.some(v => v !== null)) {
                    const style = getComputedStyle(document.documentElement);
                    const warningColor = style.getPropertyValue('--warning').trim() || '#f59e0b';
                    datasets.push({
                        label: 'Zielwert',
                        data: zielValues,
                        borderColor: warningColor,
                        borderDash: [8, 4],
                        borderWidth: 2,
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        pointBackgroundColor: warningColor,
                        spanGaps: true,
                        tension: 0
                    });
                }
            }
        } catch (e) {
            // Silent fail — Ziele nicht verfügbar
        }
    }

    // Destroy existing chart
    if (state.trendLineChartInstance) {
        state.trendLineChartInstance.destroy();
    }

    // Get theme colors
    const theme = getChartThemeColors();
    const { isDark, textColor, gridColor } = theme;

    const ctx = elements.trendLineChart.getContext('2d');
    state.trendLineChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: allDates.map(d => formatDate(d)),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false // We use custom legend
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        callback: (v) => v + '%'
                    }
                },
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor }
                }
            }
        }
    });

    // Render custom legend
    renderChartLegend();
}

// Multi-Select Dropdown for Lieferanten
function renderMultiSelectDropdown() {
    const wrapper = document.getElementById('multiSelectWrapper');
    const input = document.getElementById('multiSelectInput');
    const dropdown = document.getElementById('multiSelectDropdown');

    if (!wrapper || !dropdown) return;

    // Get all unique lieferanten
    const lieferanten = [...new Set(state.historieData.map(h => h.lieferant))].sort();

    // Build dropdown options
    let html = '';

    // Average option (always first)
    const avgSelected = state.multiSelectLieferanten.includes('__average__');
    html += `
        <div class="multi-select-option ${avgSelected ? 'selected' : ''}" data-value="__average__">
            <div class="multi-select-checkbox">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <polyline points="20,6 9,17 4,12"/>
                </svg>
            </div>
            <div class="multi-select-color" style="background: ${LIEFERANT_COLORS['__average__'].color}"></div>
            <span class="multi-select-label">Durchschnitt aller</span>
        </div>
    `;

    // Lieferant options
    let colorIndex = 0;
    lieferanten.forEach(l => {
        const isSelected = state.multiSelectLieferanten.includes(l);
        const color = LIEFERANT_COLORS['_colors_'][colorIndex % LIEFERANT_COLORS['_colors_'].length];
        const isDisabled = !isSelected && state.multiSelectLieferanten.length >= 5;

        html += `
            <div class="multi-select-option ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}" data-value="${escapeHtml(l)}" data-color="${color}">
                <div class="multi-select-checkbox">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <polyline points="20,6 9,17 4,12"/>
                    </svg>
                </div>
                <div class="multi-select-color" style="background: ${color}"></div>
                <span class="multi-select-label">${escapeHtml(l)}</span>
            </div>
        `;
        colorIndex++;
    });

    dropdown.innerHTML = html;

    // Update input text
    const inputText = input.querySelector('.multi-select-input-text');
    if (inputText) {
        const count = state.multiSelectLieferanten.length;
        if (count === 0) {
            inputText.textContent = 'Lieferanten wählen...';
        } else if (count === 1 && state.multiSelectLieferanten[0] === '__average__') {
            inputText.textContent = 'Durchschnitt aller';
        } else {
            inputText.textContent = `${count} ausgewählt`;
        }
    }

    // Event handlers for dropdown toggle
    if (!input.hasAttribute('data-initialized')) {
        input.setAttribute('data-initialized', 'true');

        input.addEventListener('click', (e) => {
            e.stopPropagation();
            wrapper.classList.toggle('open');
            state.multiSelectOpen = wrapper.classList.contains('open');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target)) {
                wrapper.classList.remove('open');
                state.multiSelectOpen = false;
            }
        });
    }

    // Event handlers for options
    dropdown.querySelectorAll('.multi-select-option').forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            if (option.classList.contains('disabled')) return;

            const value = option.dataset.value;
            const isSelected = state.multiSelectLieferanten.includes(value);

            if (isSelected) {
                // Deselect (but keep at least one)
                if (state.multiSelectLieferanten.length > 1) {
                    state.multiSelectLieferanten = state.multiSelectLieferanten.filter(v => v !== value);
                }
            } else {
                // Select (max 5)
                if (state.multiSelectLieferanten.length < 5) {
                    state.multiSelectLieferanten.push(value);
                }
            }

            // Re-render chart and dropdown
            renderTrendLineChart();
        });
    });
}

// Custom Legend for Multi-Line Chart
function renderChartLegend() {
    const legendContainer = document.getElementById('chartLegendCustom');
    if (!legendContainer) return;

    let colorIndex = 0;
    let html = '';

    state.multiSelectLieferanten.forEach(key => {
        let label, color;

        if (key === '__average__') {
            label = 'Durchschnitt aller';
            color = LIEFERANT_COLORS['__average__'].color;
        } else {
            label = key;
            color = LIEFERANT_COLORS['_colors_'][colorIndex % LIEFERANT_COLORS['_colors_'].length];
            colorIndex++;
        }

        html += `
            <div class="chart-legend-item" data-key="${key}">
                <div class="chart-legend-color" style="background: ${color}"></div>
                <span class="chart-legend-text">${label}</span>
            </div>
        `;
    });

    legendContainer.innerHTML = html;

    // Click to toggle visibility (optional feature)
    legendContainer.querySelectorAll('.chart-legend-item').forEach(item => {
        item.addEventListener('click', () => {
            const key = item.dataset.key;
            const chart = state.trendLineChartInstance;
            if (!chart) return;

            const datasetIndex = state.multiSelectLieferanten.indexOf(key);
            if (datasetIndex === -1) return;

            const meta = chart.getDatasetMeta(datasetIndex);
            meta.hidden = !meta.hidden;
            item.classList.toggle('hidden', meta.hidden);
            chart.update();
        });
    });
}

function renderTrendBarChart() {
    const historie = state.historieData;
    if (!historie || historie.length === 0) return;

    // Calculate average per lieferant
    const byLieferant = {};
    historie.forEach(h => {
        if (!byLieferant[h.lieferant]) {
            byLieferant[h.lieferant] = { sum: 0, count: 0 };
        }
        byLieferant[h.lieferant].sum += h.ergebnis;
        byLieferant[h.lieferant].count++;
    });

    const lieferanten = Object.keys(byLieferant).sort((a, b) => {
        const avgA = byLieferant[a].sum / byLieferant[a].count;
        const avgB = byLieferant[b].sum / byLieferant[b].count;
        return avgB - avgA;
    });

    const averages = lieferanten.map(l => (byLieferant[l].sum / byLieferant[l].count).toFixed(1));
    const colors = averages.map(avg => {
        if (avg >= state.settings.threshold_success) return '#22c55e';
        if (avg >= state.settings.threshold_warning) return '#f59e0b';
        return '#ef4444';
    });

    // Destroy existing chart
    if (state.trendBarChartInstance) {
        state.trendBarChartInstance.destroy();
    }

    // Get theme colors
    const theme = getChartThemeColors();
    const { isDark, textColor, gridColor } = theme;

    const ctx = elements.trendBarChart.getContext('2d');
    state.trendBarChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: lieferanten,
            datasets: [{
                label: 'Durchschnitt',
                data: averages,
                backgroundColor: colors,
                borderColor: colors,
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `Durchschnitt: ${ctx.parsed.y}%`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        callback: (v) => v + '%'
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: textColor }
                }
            }
        }
    });
}

// ============================================================================
// Kategorie-Trend Chart (Phase 3.1)
// ============================================================================

const KATEGORIE_COLORS = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'
];

async function renderKategorieTrendChart() {
    const section = document.getElementById('kategorieTrendSection');
    const lieferantLabel = document.getElementById('kategorieTrendLieferant');
    if (!section) return;

    // Only show when a specific lieferant is selected
    if (!state.selectedTrendLieferant) {
        section.style.display = 'none';
        return;
    }

    try {
        const trendLieferantId = getLieferantIdByName(state.selectedTrendLieferant);
        if (!trendLieferantId) { section.style.display = 'none'; return; }
        const trendData = await invoke('get_kategorie_trend_cmd', { lieferantId: trendLieferantId });

        if (!trendData || trendData.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        if (lieferantLabel) lieferantLabel.textContent = '— ' + state.selectedTrendLieferant;

        // Collect all unique groups
        const gruppen = [...new Set(trendData.flatMap(e => e.categories.map(c => c.gruppe)))];
        const dates = trendData.map(e => e.datum);

        // Build datasets — one line per group
        const datasets = gruppen.map((gruppe, idx) => {
            const color = KATEGORIE_COLORS[idx % KATEGORIE_COLORS.length];
            const values = trendData.map(e => {
                const cat = e.categories.find(c => c.gruppe === gruppe);
                return cat ? parseFloat(cat.score.toFixed(1)) : null;
            });

            return {
                label: gruppe,
                data: values,
                borderColor: color,
                backgroundColor: color + '15',
                borderWidth: 2,
                fill: false,
                tension: 0.4,
                pointBackgroundColor: color,
                pointRadius: 4,
                pointHoverRadius: 6,
                spanGaps: true
            };
        });

        // Also add the Gesamtergebnis line
        datasets.unshift({
            label: 'Gesamt',
            data: trendData.map(e => parseFloat(e.ergebnis.toFixed(1))),
            borderColor: getAccentColor(),
            backgroundColor: getAccentColor() + '15',
            borderWidth: 3,
            borderDash: [6, 3],
            fill: false,
            tension: 0.4,
            pointBackgroundColor: getAccentColor(),
            pointRadius: 5,
            pointHoverRadius: 7,
            spanGaps: true
        });

        // Destroy old chart
        if (state.kategorieTrendChartInstance) {
            state.kategorieTrendChartInstance.destroy();
        }

        const theme = getChartThemeColors();
        const { textColor, gridColor } = theme;
        const canvas = document.getElementById('kategorieTrendChart');
        const ctx = canvas.getContext('2d');

        state.kategorieTrendChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: dates.map(d => formatDate(d)),
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        grid: { color: gridColor },
                        ticks: { color: textColor, callback: (v) => v + '%' }
                    },
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: textColor }
                    }
                }
            }
        });

        // Custom legend
        const legendEl = document.getElementById('kategorieTrendLegend');
        if (legendEl) {
            legendEl.innerHTML = datasets.map((ds, i) => `
                <div class="chart-legend-item" data-index="${i}">
                    <div class="chart-legend-color" style="background: ${ds.borderColor}"></div>
                    <span class="chart-legend-text">${ds.label}</span>
                </div>
            `).join('');

            legendEl.querySelectorAll('.chart-legend-item').forEach(item => {
                item.addEventListener('click', () => {
                    const idx = parseInt(item.dataset.index);
                    const chart = state.kategorieTrendChartInstance;
                    if (!chart) return;
                    const meta = chart.getDatasetMeta(idx);
                    meta.hidden = !meta.hidden;
                    item.classList.toggle('hidden', meta.hidden);
                    chart.update();
                });
            });
        }
    } catch (e) {
        console.warn('Kategorie-Trend laden fehlgeschlagen:', e);
        section.style.display = 'none';
    }
}

// ============================================================================
// SE-Team-Vergleich Heatmap (Phase 3.2)
// ============================================================================

async function renderSeTeamVergleich() {
    const section = document.getElementById('seTeamVergleichSection');
    const wrapper = document.getElementById('seTeamHeatmapWrapper');
    if (!section || !wrapper) return;

    try {
        const data = await invoke('get_se_team_vergleich_cmd');

        if (!data || data.length === 0) {
            section.style.display = 'none';
            return;
        }

        // Build matrix: lieferant → { se_team → { avg_score, count } }
        const lieferanten = [...new Set(data.map(d => d.lieferant))].sort();
        const seTeams = [...new Set(data.map(d => d.se_team))].sort();

        // Need at least 2 SE-Teams for a meaningful comparison
        if (seTeams.length < 2) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';

        const matrix = {};
        data.forEach(d => {
            if (!matrix[d.lieferant]) matrix[d.lieferant] = {};
            matrix[d.lieferant][d.se_team] = { score: d.avg_score, count: d.count };
        });

        // Header row
        let html = '<table class="se-team-heatmap"><thead><tr><th>Lieferant</th>';
        seTeams.forEach(st => {
            html += `<th>${escapeHtml(st)}</th>`;
        });
        html += '<th>Abweichung</th></tr></thead><tbody>';

        // Data rows
        lieferanten.forEach(l => {
            html += `<tr><td>${escapeHtml(l)}</td>`;
            const scores = [];
            seTeams.forEach(st => {
                const cell = matrix[l] && matrix[l][st];
                if (cell) {
                    scores.push(cell.score);
                    const bg = getHeatmapColor(cell.score);
                    html += `<td class="heatmap-cell" style="background:${bg}">${cell.score.toFixed(1)}%<span class="heatmap-count">(n=${cell.count})</span></td>`;
                } else {
                    html += `<td class="heatmap-empty">—</td>`;
                }
            });

            // Deviation column
            if (scores.length >= 2) {
                const min = Math.min(...scores);
                const max = Math.max(...scores);
                const spread = max - min;
                const devHtml = spread > 15
                    ? `<span class="se-team-deviation-badge">${spread.toFixed(1)}%</span>`
                    : `${spread.toFixed(1)}%`;
                html += `<td>${devHtml}</td>`;
            } else {
                html += `<td class="heatmap-empty">—</td>`;
            }
            html += '</tr>';
        });

        html += '</tbody></table>';

        // Legend
        html += `<div class="se-team-heatmap-info">
            <div class="se-team-heatmap-legend">
                <div class="se-team-heatmap-legend-item"><div class="se-team-heatmap-legend-color" style="background:#22c55e"></div><span>≥${state.settings.threshold_success}%</span></div>
                <div class="se-team-heatmap-legend-item"><div class="se-team-heatmap-legend-color" style="background:#f59e0b"></div><span>${state.settings.threshold_warning}–${state.settings.threshold_success - 1}%</span></div>
                <div class="se-team-heatmap-legend-item"><div class="se-team-heatmap-legend-color" style="background:#ef4444"></div><span>&lt;${state.settings.threshold_warning}%</span></div>
            </div>
            <span>Abweichung &gt;15%: markiert</span>
        </div>`;

        wrapper.innerHTML = html;
    } catch (e) {
        console.warn('SE-Team-Vergleich laden fehlgeschlagen:', e);
        section.style.display = 'none';
    }
}

function getHeatmapColor(score) {
    if (score >= state.settings.threshold_success) {
        // Green gradient: darker green for higher scores
        const t = Math.min((score - state.settings.threshold_success) / (100 - state.settings.threshold_success), 1);
        return `hsl(142, ${60 + t * 20}%, ${42 - t * 8}%)`;
    } else if (score >= state.settings.threshold_warning) {
        // Yellow-orange gradient
        const t = (score - state.settings.threshold_warning) / (state.settings.threshold_success - state.settings.threshold_warning);
        return `hsl(${35 + t * 10}, ${70 + t * 10}%, ${48 - t * 5}%)`;
    } else {
        // Red gradient: darker red for lower scores
        const t = Math.min(score / state.settings.threshold_warning, 1);
        return `hsl(${t * 10}, ${65 + (1 - t) * 15}%, ${42 + t * 5}%)`;
    }
}

// Statistical helper functions
function calcMedian(sortedArr) {
    const n = sortedArr.length;
    if (n === 0) return 0;
    const mid = Math.floor(n / 2);
    return n % 2 !== 0 ? sortedArr[mid] : (sortedArr[mid - 1] + sortedArr[mid]) / 2;
}

function calcPercentile(sortedArr, p) {
    if (sortedArr.length === 0) return 0;
    const index = (p / 100) * (sortedArr.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sortedArr[lower];
    return sortedArr[lower] + (sortedArr[upper] - sortedArr[lower]) * (index - lower);
}

function calcStdDev(values, mean) {
    if (values.length < 2) return 0;
    const sqDiffs = values.map(v => Math.pow(v - mean, 2));
    return Math.sqrt(sqDiffs.reduce((s, d) => s + d, 0) / (values.length - 1));
}

function getQuarterKey(datum) {
    const d = new Date(datum);
    const q = Math.ceil((d.getMonth() + 1) / 3);
    return `Q${q}`;
}

function renderTrendsStats() {
    const historie = state.historieData;
    if (!historie || historie.length === 0) {
        elements.trendsStats.innerHTML = '';
        return;
    }

    // Filter by selected lieferant if applicable
    let data = state.selectedTrendLieferant
        ? historie.filter(h => h.lieferant === state.selectedTrendLieferant)
        : historie;

    const total = data.length;

    // Guard against empty data
    if (total === 0) {
        elements.trendsStats.innerHTML = `
            <div class="trend-stat-card">
                <div class="trend-stat-value">0</div>
                <div class="trend-stat-label">Keine Bewertungen</div>
            </div>`;
        return;
    }

    const scores = data.map(h => h.ergebnis);
    const avg = scores.reduce((s, v) => s + v, 0) / total;
    const sorted = [...scores].sort((a, b) => a - b);
    const median = calcMedian(sorted);
    const stdDev = calcStdDev(scores, avg);
    const p25 = calcPercentile(sorted, 25);
    const p75 = calcPercentile(sorted, 75);

    // Find best and worst evaluations (with full details)
    const bestEntry = data.reduce((max, h) => h.ergebnis > max.ergebnis ? h : max, data[0]);
    const worstEntry = data.reduce((min, h) => h.ergebnis < min.ergebnis ? h : min, data[0]);

    // Count by category
    const excellent = data.filter(h => h.ergebnis >= state.settings.threshold_success).length;
    const good = data.filter(h => h.ergebnis >= state.settings.threshold_warning && h.ergebnis < state.settings.threshold_success).length;
    const poor = data.filter(h => h.ergebnis < state.settings.threshold_warning).length;

    // YoY comparison: same quarter, previous year
    let yoyHtml = '';
    const now = new Date();
    const currentQ = getQuarterKey(now.toISOString().split('T')[0]);
    const currentYear = now.getFullYear();
    const lastYear = currentYear - 1;

    const thisYearData = data.filter(h => {
        const d = new Date(h.datum);
        return d.getFullYear() === currentYear && getQuarterKey(h.datum) === currentQ;
    });
    const lastYearData = data.filter(h => {
        const d = new Date(h.datum);
        return d.getFullYear() === lastYear && getQuarterKey(h.datum) === currentQ;
    });

    if (thisYearData.length > 0 && lastYearData.length > 0) {
        const thisAvg = thisYearData.reduce((s, h) => s + h.ergebnis, 0) / thisYearData.length;
        const lastAvg = lastYearData.reduce((s, h) => s + h.ergebnis, 0) / lastYearData.length;
        const diff = thisAvg - lastAvg;
        const diffSign = diff >= 0 ? '+' : '';
        const diffClass = diff >= 0 ? 'success' : 'danger';
        const arrowSvg = diff >= 0
            ? '<polyline points="18,15 12,9 6,15"/>'
            : '<polyline points="6,9 12,15 18,9"/>';
        yoyHtml = `
        <div class="trend-stat-card" title="Jahresvergleich: Veränderung des Durchschnitts im gleichen Quartal (${currentQ}) gegenüber dem Vorjahr">
            <div class="trend-stat-icon ${diffClass}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    ${arrowSvg}
                </svg>
            </div>
            <div class="trend-stat-value ${diffClass}">${diffSign}${diff.toFixed(1)}%</div>
            <div class="trend-stat-label">YoY ${currentQ} (${lastYear} → ${currentYear})</div>
        </div>`;
    }

    elements.trendsStats.innerHTML = `
        <div class="trend-stat-card" title="Gesamtanzahl aller Bewertungen im ausgewählten Zeitraum">
            <div class="trend-stat-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 20V10"/>
                    <path d="M18 20V4"/>
                    <path d="M6 20v-4"/>
                </svg>
            </div>
            <div class="trend-stat-value">${total}</div>
            <div class="trend-stat-label">Bewertungen</div>
        </div>
        <div class="trend-stat-card" title="Arithmetisches Mittel aller Bewertungsergebnisse">
            <div class="trend-stat-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
                </svg>
            </div>
            <div class="trend-stat-value">${avg.toFixed(1)}%</div>
            <div class="trend-stat-label">Durchschnitt</div>
        </div>
        <div class="trend-stat-card" title="Median: Der mittlere Wert aller Bewertungen — 50% liegen darüber, 50% darunter">
            <div class="trend-stat-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="4" y1="12" x2="20" y2="12"/>
                    <circle cx="12" cy="12" r="2"/>
                </svg>
            </div>
            <div class="trend-stat-value">${median.toFixed(1)}%</div>
            <div class="trend-stat-label">Median</div>
        </div>
        <div class="trend-stat-card" title="Standardabweichung: Streuung der Werte um den Durchschnitt — niedriger = konsistenter">
            <div class="trend-stat-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 20c2-4 4-16 8-16s6 12 8 16"/>
                </svg>
            </div>
            <div class="trend-stat-value">σ ${stdDev.toFixed(1)}</div>
            <div class="trend-stat-label">Std.-Abweichung</div>
        </div>
        <div class="trend-stat-card" title="Interquartilsbereich: Die mittleren 50% aller Bewertungen liegen in diesem Bereich (25. bis 75. Perzentil)">
            <div class="trend-stat-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="6" y="6" width="12" height="12" rx="2"/>
                    <line x1="6" y1="12" x2="18" y2="12"/>
                </svg>
            </div>
            <div class="trend-stat-value">${p25.toFixed(1)}–${p75.toFixed(1)}%</div>
            <div class="trend-stat-label">IQR (P25–P75)</div>
        </div>
        <div class="trend-stat-card clickable kpi-best-card" data-kpi-type="best" data-bewertung-id="${bestEntry.id}" title="Beste Bewertung: ${bestEntry.ergebnis.toFixed(1)}% — ${escapeHtml(bestEntry.lieferant)} am ${formatDate(bestEntry.datum)}. Klicken für Details.">
            <div class="trend-stat-icon success">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20,6 9,17 4,12"/>
                </svg>
            </div>
            <div class="trend-stat-value">${bestEntry.ergebnis.toFixed(1)}%</div>
            <div class="trend-stat-label">Bester Wert</div>
            <div class="trend-stat-arrow">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M7 17L17 7"/>
                    <path d="M7 7h10v10"/>
                </svg>
            </div>
        </div>
        <div class="trend-stat-card clickable kpi-worst-card" data-kpi-type="worst" data-bewertung-id="${worstEntry.id}" title="Schlechteste Bewertung: ${worstEntry.ergebnis.toFixed(1)}% — ${escapeHtml(worstEntry.lieferant)} am ${formatDate(worstEntry.datum)}. Klicken für Details.">
            <div class="trend-stat-icon danger">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </div>
            <div class="trend-stat-value">${worstEntry.ergebnis.toFixed(1)}%</div>
            <div class="trend-stat-label">Schlechtester</div>
            <div class="trend-stat-arrow">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M7 17L17 7"/>
                    <path d="M7 7h10v10"/>
                </svg>
            </div>
        </div>
        <div class="trend-stat-card" title="Anzahl Bewertungen mit Ergebnis ≥${state.settings.threshold_success}% — als gut eingestuft">
            <div class="trend-stat-icon success">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                    <line x1="9" y1="9" x2="9.01" y2="9"/>
                    <line x1="15" y1="9" x2="15.01" y2="9"/>
                </svg>
            </div>
            <div class="trend-stat-value">${excellent}</div>
            <div class="trend-stat-label">≥${state.settings.threshold_success}% (Gut)</div>
        </div>
        <div class="trend-stat-card" title="Anzahl Bewertungen zwischen ${state.settings.threshold_warning}% und ${state.settings.threshold_success - 1}% — Verbesserungspotenzial">
            <div class="trend-stat-icon warning">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="8" y1="15" x2="16" y2="15"/>
                    <line x1="9" y1="9" x2="9.01" y2="9"/>
                    <line x1="15" y1="9" x2="15.01" y2="9"/>
                </svg>
            </div>
            <div class="trend-stat-value">${good}</div>
            <div class="trend-stat-label">${state.settings.threshold_warning}–${state.settings.threshold_success - 1}% (Mittel)</div>
        </div>
        <div class="trend-stat-card" title="Anzahl Bewertungen unter ${state.settings.threshold_warning}% — kritisch, Maßnahmen erforderlich">
            <div class="trend-stat-icon danger">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M16 16s-1.5-2-4-2-4 2-4 2"/>
                    <line x1="9" y1="9" x2="9.01" y2="9"/>
                    <line x1="15" y1="9" x2="15.01" y2="9"/>
                </svg>
            </div>
            <div class="trend-stat-value">${poor}</div>
            <div class="trend-stat-label">&lt;${state.settings.threshold_warning}% (Kritisch)</div>
        </div>
        ${yoyHtml}
    `;

    // Add event listeners for clickable KPI cards
    const bestCard = elements.trendsStats.querySelector('.kpi-best-card');
    if (bestCard) {
        bestCard.addEventListener('click', () => showKpiModal('best', parseInt(bestCard.dataset.bewertungId)));
    }
    const worstCard = elements.trendsStats.querySelector('.kpi-worst-card');
    if (worstCard) {
        worstCard.addEventListener('click', () => showKpiModal('worst', parseInt(worstCard.dataset.bewertungId)));
    }
}

// KPI Modal for Best/Worst Value Details
let kpiModalChartInstance = null;

async function showKpiModal(type, bewertungId) {
    try {
        // Load full evaluation data
        const bewertung = await invoke('lade_bewertung_cmd', { id: bewertungId });
        if (!bewertung) {
            showStatus('Bewertung nicht gefunden', true);
            return;
        }

        // Find this supplier's history for trend chart
        const supplierHistory = state.historieData
            .filter(h => h.lieferant === bewertung.lieferant)
            .sort((a, b) => new Date(a.datum) - new Date(b.datum))
            .slice(-5); // Last 5 evaluations

        // Calculate category scores
        const categoryScores = calculateCategoryScores(bewertung.antworten);

        // Identify weak categories (< 75%)
        const weakCategories = categoryScores.filter(c => c.percentage < 75);

        // Modal title and style based on type
        const isBest = type === 'best';
        const titleText = isBest ? 'Bester Wert Details' : 'Schlechtester Wert Details';
        const titleClass = isBest ? 'success' : 'danger';
        const iconSvg = isBest
            ? '<polyline points="20,6 9,17 4,12"/>'
            : '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';

        // Create modal HTML
        const modalHtml = `
            <div class="kpi-modal-overlay" id="kpiModalOverlay">
                <div class="kpi-modal">
                    <div class="kpi-modal-header">
                        <h3 class="${titleClass}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                ${iconSvg}
                            </svg>
                            ${titleText}
                        </h3>
                        <button class="kpi-modal-close" id="kpiModalCloseBtn">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                    </div>
                    <div class="kpi-modal-body">
                        <div class="kpi-modal-info">
                            <div class="kpi-modal-info-item">
                                <span class="kpi-modal-info-label">Lieferant</span>
                                <span class="kpi-modal-info-value">${escapeHtml(bewertung.lieferant)}</span>
                            </div>
                            <div class="kpi-modal-info-item">
                                <span class="kpi-modal-info-label">Datum</span>
                                <span class="kpi-modal-info-value">${formatDate(bewertung.datum)}</span>
                            </div>
                            <div class="kpi-modal-info-item highlight">
                                <span class="kpi-modal-info-label">Bewertung</span>
                                <span class="kpi-modal-info-value large ${titleClass}">${bewertung.ergebnis.toFixed(1)}%</span>
                            </div>
                        </div>

                        ${weakCategories.length > 0 ? `
                            <div class="kpi-modal-section">
                                <div class="kpi-modal-section-title">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                                        <line x1="12" y1="9" x2="12" y2="13"/>
                                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                                    </svg>
                                    ${isBest ? 'Verbesserungspotenzial' : 'Schwache Kategorien'}
                                </div>
                                <div class="kpi-modal-categories">
                                    ${weakCategories.map(c => `
                                        <div class="kpi-modal-category ${c.percentage >= state.settings.threshold_warning ? 'warning' : ''}">
                                            <span class="kpi-modal-category-name">${escapeHtml(c.name)}</span>
                                            <span class="kpi-modal-category-score">${c.percentage.toFixed(1)}%</span>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}

                        ${supplierHistory.length > 1 ? `
                            <div class="kpi-modal-section">
                                <div class="kpi-modal-section-title">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
                                    </svg>
                                    Trend (letzte ${supplierHistory.length} Bewertungen)
                                </div>
                                <div class="kpi-modal-chart">
                                    <canvas id="kpiModalChart"></canvas>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    <div class="kpi-modal-footer">
                        <button class="btn btn-secondary" id="kpiModalCancelBtn">Schließen</button>
                        <button class="btn btn-primary" id="kpiModalLoadBtn" data-id="${bewertungId}">
                            Zur Bewertung
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if any
        const existingModal = document.getElementById('kpiModalOverlay');
        if (existingModal) {
            existingModal.remove();
        }

        // Add modal to body
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Show modal with animation
        const modalOverlay = document.getElementById('kpiModalOverlay');
        requestAnimationFrame(() => {
            modalOverlay.classList.add('visible');
        });

        // Render mini chart if we have history
        if (supplierHistory.length > 1) {
            renderKpiModalChart(supplierHistory, isBest);
        }

        // Close on ESC key — Handler wird in closeKpiModal() entfernt
        state._kpiEscHandler = (e) => {
            if (e.key === 'Escape') closeKpiModal();
        };
        document.addEventListener('keydown', state._kpiEscHandler);

        // Close on backdrop click (einmalig)
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) closeKpiModal();
        }, { once: true });

        // Add event listeners for modal buttons (einmalig)
        document.getElementById('kpiModalCloseBtn').addEventListener('click', closeKpiModal, { once: true });
        document.getElementById('kpiModalCancelBtn').addEventListener('click', closeKpiModal, { once: true });
        document.getElementById('kpiModalLoadBtn').addEventListener('click', function() {
            const id = parseInt(this.dataset.id);
            closeKpiModal();
            loadBewertung(id);
        });

    } catch (e) {
        console.error('Error showing KPI modal:', e);
        showStatus('Fehler beim Laden der Details: ' + e, true);
    }
}

function closeKpiModal() {
    const modalOverlay = document.getElementById('kpiModalOverlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('visible');
        // ESC-Handler entfernen
        if (state._kpiEscHandler) {
            document.removeEventListener('keydown', state._kpiEscHandler);
            state._kpiEscHandler = null;
        }
        // Destroy chart instance
        if (kpiModalChartInstance) {
            kpiModalChartInstance.destroy();
            kpiModalChartInstance = null;
        }
        // Remove after animation
        setTimeout(() => {
            modalOverlay.remove();
        }, 300);
    }
}

function renderKpiModalChart(history, isBest) {
    const canvas = document.getElementById('kpiModalChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const theme = getChartThemeColors();
    const { isDark, textColor, gridColor } = theme;
    const lineColor = isBest ? '#22c55e' : '#ef4444';

    const labels = history.map(h => formatDate(h.datum));
    const values = history.map(h => h.ergebnis);

    kpiModalChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Bewertung',
                data: values,
                borderColor: lineColor,
                backgroundColor: lineColor + '20',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: lineColor,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.parsed.y.toFixed(1)}%`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        callback: (v) => v + '%',
                        stepSize: 25
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        color: textColor,
                        maxRotation: 45
                    }
                }
            }
        }
    });
}

function destroyCharts() {
    if (state.trendLineChartInstance) {
        state.trendLineChartInstance.destroy();
        state.trendLineChartInstance = null;
    }
    if (state.trendBarChartInstance) {
        state.trendBarChartInstance.destroy();
        state.trendBarChartInstance = null;
    }
    if (state.kategorieTrendChartInstance) {
        state.kategorieTrendChartInstance.destroy();
        state.kategorieTrendChartInstance = null;
    }
    if (state.compareRadarChartInstance) {
        state.compareRadarChartInstance.destroy();
        state.compareRadarChartInstance = null;
    }
    if (state.crossDbCategoryChartInstance) {
        state.crossDbCategoryChartInstance.destroy();
        state.crossDbCategoryChartInstance = null;
    }
    if (state.crossDbTrendChartInstance) {
        state.crossDbTrendChartInstance.destroy();
        state.crossDbTrendChartInstance = null;
    }
}

// ============================================================================
// Compare View
// ============================================================================
function renderCompareView() {
    if (state.crossDbMode) {
        renderCrossDbView();
    } else {
        renderCompareDropdowns();
        updateCompareCards();
    }
}

function renderCompareDropdowns() {
    const lieferanten = [...new Set(state.historieData.map(h => h.lieferant))].sort();

    // Dropdown 1
    let html1 = '<div class="custom-dropdown-item" data-value="">Lieferant wählen</div>';
    html1 += lieferanten.map(l => `
        <div class="custom-dropdown-item${state.selectedCompare1 === l ? ' selected' : ''}" data-value="${escapeHtml(l)}">${escapeHtml(l)}</div>
    `).join('');
    elements.compare1Dropdown.innerHTML = html1;
    elements.compare1Input.value = state.selectedCompare1 || 'Lieferant wählen';

    // Dropdown 2
    let html2 = '<div class="custom-dropdown-item" data-value="">Lieferant wählen</div>';
    html2 += lieferanten.map(l => `
        <div class="custom-dropdown-item${state.selectedCompare2 === l ? ' selected' : ''}" data-value="${escapeHtml(l)}">${escapeHtml(l)}</div>
    `).join('');
    elements.compare2Dropdown.innerHTML = html2;
    elements.compare2Input.value = state.selectedCompare2 || 'Lieferant wählen';

    // Add click handlers
    elements.compare1Dropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            state.selectedCompare1 = item.dataset.value || null;
            elements.compare1Input.value = item.dataset.value || 'Lieferant wählen';
            elements.compare1Dropdown.classList.remove('visible');
            updateCompareCards();
        });
    });

    elements.compare2Dropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            state.selectedCompare2 = item.dataset.value || null;
            elements.compare2Input.value = item.dataset.value || 'Lieferant wählen';
            elements.compare2Dropdown.classList.remove('visible');
            updateCompareCards();
        });
    });
}

function updateCompareCards() {
    const historie = state.historieData;

    // Update Card 1
    if (state.selectedCompare1) {
        const data1 = historie.filter(h => h.lieferant === state.selectedCompare1);
        renderCompareCard(1, state.selectedCompare1, data1);
    } else {
        resetCompareCard(1);
    }

    // Update Card 2
    if (state.selectedCompare2) {
        const data2 = historie.filter(h => h.lieferant === state.selectedCompare2);
        renderCompareCard(2, state.selectedCompare2, data2);
    } else {
        resetCompareCard(2);
    }

    // Winner/Loser indicator
    const card1 = document.getElementById('compareCard1');
    const card2 = document.getElementById('compareCard2');
    card1.classList.remove('compare-winner', 'compare-loser', 'compare-tied');
    card2.classList.remove('compare-winner', 'compare-loser', 'compare-tied');

    if (state.selectedCompare1 && state.selectedCompare2) {
        const d1 = historie.filter(h => h.lieferant === state.selectedCompare1);
        const d2 = historie.filter(h => h.lieferant === state.selectedCompare2);
        if (d1.length > 0 && d2.length > 0) {
            const avg1 = d1.reduce((s, h) => s + h.ergebnis, 0) / d1.length;
            const avg2 = d2.reduce((s, h) => s + h.ergebnis, 0) / d2.length;
            if (Math.abs(avg1 - avg2) < 1) {
                card1.classList.add('compare-tied');
                card2.classList.add('compare-tied');
            } else if (avg1 > avg2) {
                card1.classList.add('compare-winner');
                card2.classList.add('compare-loser');
            } else {
                card1.classList.add('compare-loser');
                card2.classList.add('compare-winner');
            }
        }
    }

    // Render radar chart if both selected
    if (state.selectedCompare1 && state.selectedCompare2) {
        renderCompareRadarChart();
    } else if (state.compareRadarChartInstance) {
        state.compareRadarChartInstance.destroy();
        state.compareRadarChartInstance = null;
    }
}

function renderCompareCard(num, lieferant, data) {
    const titleEl = document.getElementById(`compareTitle${num}`);
    const scoreEl = document.getElementById(`compareScore${num}`);
    const bodyEl = document.getElementById(`compareBody${num}`);

    titleEl.textContent = lieferant;

    if (data.length === 0) {
        scoreEl.textContent = '--%';
        scoreEl.className = 'compare-card-score';
        bodyEl.innerHTML = '<p class="compare-placeholder">Keine Daten vorhanden</p>';
        return;
    }

    const avg = data.reduce((sum, h) => sum + h.ergebnis, 0) / data.length;
    const resultClass = avg >= state.settings.threshold_success ? 'success' : avg >= state.settings.threshold_warning ? 'warning' : 'danger';

    scoreEl.textContent = `${avg.toFixed(1)}%`;
    scoreEl.className = `compare-card-score ${resultClass}`;

    const best = Math.max(...data.map(h => h.ergebnis));
    const worst = Math.min(...data.map(h => h.ergebnis));
    const latest = [...data].sort((a, b) => new Date(b.datum) - new Date(a.datum))[0];

    bodyEl.innerHTML = `
        <div class="compare-stat-row">
            <span class="compare-stat-label">Bewertungen</span>
            <span class="compare-stat-value">${data.length}</span>
        </div>
        <div class="compare-stat-row">
            <span class="compare-stat-label">Spanne</span>
            <span class="compare-stat-value">${worst.toFixed(1)}% – ${best.toFixed(1)}%</span>
        </div>
        <div class="compare-stat-row">
            <span class="compare-stat-label">Letzte Bewertung</span>
            <span class="compare-stat-value">${formatDate(latest.datum)}</span>
        </div>
    `;
}

function resetCompareCard(num) {
    const titleEl = document.getElementById(`compareTitle${num}`);
    const scoreEl = document.getElementById(`compareScore${num}`);
    const bodyEl = document.getElementById(`compareBody${num}`);

    titleEl.textContent = `Lieferant ${num}`;
    scoreEl.textContent = '--%';
    scoreEl.className = 'compare-card-score';
    bodyEl.innerHTML = '<p class="compare-placeholder">Wählen Sie einen Lieferanten</p>';
}

function renderCompareRadarChart() {
    const historie = state.historieData;

    const data1 = historie.filter(h => h.lieferant === state.selectedCompare1);
    const data2 = historie.filter(h => h.lieferant === state.selectedCompare2);

    if (data1.length === 0 || data2.length === 0) return;

    // Calculate metrics for radar chart
    const avg1 = data1.reduce((sum, h) => sum + h.ergebnis, 0) / data1.length;
    const avg2 = data2.reduce((sum, h) => sum + h.ergebnis, 0) / data2.length;

    const best1 = Math.max(...data1.map(h => h.ergebnis));
    const best2 = Math.max(...data2.map(h => h.ergebnis));

    const consistency1 = 100 - (Math.max(...data1.map(h => h.ergebnis)) - Math.min(...data1.map(h => h.ergebnis)));
    const consistency2 = 100 - (Math.max(...data2.map(h => h.ergebnis)) - Math.min(...data2.map(h => h.ergebnis)));

    // Trend calculation (recent vs older)
    const sorted1 = [...data1].sort((a, b) => new Date(b.datum) - new Date(a.datum));
    const sorted2 = [...data2].sort((a, b) => new Date(b.datum) - new Date(a.datum));

    const recent1 = sorted1.slice(0, Math.ceil(sorted1.length / 2));
    const older1 = sorted1.slice(Math.ceil(sorted1.length / 2));
    const trend1 = older1.length > 0
        ? 50 + ((recent1.reduce((s, h) => s + h.ergebnis, 0) / recent1.length) -
                (older1.reduce((s, h) => s + h.ergebnis, 0) / older1.length))
        : 50;

    const recent2 = sorted2.slice(0, Math.ceil(sorted2.length / 2));
    const older2 = sorted2.slice(Math.ceil(sorted2.length / 2));
    const trend2 = older2.length > 0
        ? 50 + ((recent2.reduce((s, h) => s + h.ergebnis, 0) / recent2.length) -
                (older2.reduce((s, h) => s + h.ergebnis, 0) / older2.length))
        : 50;

    // Destroy existing chart
    if (state.compareRadarChartInstance) {
        state.compareRadarChartInstance.destroy();
    }

    const theme = getChartThemeColors();
    const { isDark, textColor } = theme;

    const ctx = elements.compareRadarChart.getContext('2d');
    state.compareRadarChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['Durchschnitt', 'Bestwert', 'Konstanz', 'Trend'],
            datasets: [
                {
                    label: state.selectedCompare1,
                    data: [avg1, best1, consistency1, trend1],
                    borderColor: getAccentColor(),
                    backgroundColor: getAccentColor() + '33',
                    borderWidth: 2,
                    pointBackgroundColor: getAccentColor()
                },
                {
                    label: state.selectedCompare2,
                    data: [avg2, best2, consistency2, trend2],
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.2)',
                    borderWidth: 2,
                    pointBackgroundColor: '#22c55e'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: { color: textColor }
                }
            },
            scales: {
                r: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        color: textColor,
                        backdropColor: 'transparent'
                    },
                    grid: {
                        color: isDark ? '#334155' : '#e2e8f0'
                    },
                    pointLabels: {
                        color: textColor
                    }
                }
            }
        }
    });
}

// ============================================================================
// Cross-DB Vergleich
// ============================================================================

function initCrossDbEvents() {
    const localBtn = document.getElementById('compareModeLocal');
    const crossBtn = document.getElementById('compareModeCrossDb');
    const crossDbPanel = document.getElementById('crossDbPanel');
    const localHeader = document.getElementById('localCompareHeader');
    const compareContent = document.getElementById('compareContent');
    const crossDbResult = document.getElementById('crossDbResult');
    const addBtn = document.getElementById('crossDbAddBtn');
    const supplierInput = document.getElementById('crossDbSupplierInput');
    const supplierWrapper = document.getElementById('crossDbSupplierWrapper');

    if (!localBtn || !crossBtn) return;

    // Einklappen-Button
    const collapseBtn = document.getElementById('compareCollapseBtn');
    const collapseHeader = document.getElementById('compareSelectionHeader');
    const collapseBody = document.getElementById('compareSelectionBody');
    const collapseIcon = document.getElementById('compareCollapseIcon');
    const collapseText = document.getElementById('compareCollapseText');

    function toggleCompareSelection() {
        if (!collapseBody) return;
        const isCollapsed = collapseBody.classList.toggle('collapsed');
        if (collapseIcon) collapseIcon.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
        if (collapseText) collapseText.textContent = isCollapsed ? 'Ausklappen' : 'Einklappen';
    }

    if (collapseBtn) collapseBtn.addEventListener('click', toggleCompareSelection);
    // Auch der gesamte Header ist klickbar
    if (collapseHeader) collapseHeader.addEventListener('click', (e) => {
        if (e.target === collapseHeader || e.target.classList.contains('compare-selection-title')) {
            toggleCompareSelection();
        }
    });

    localBtn.addEventListener('click', () => {
        state.crossDbMode = false;
        localBtn.classList.add('active');
        crossBtn.classList.remove('active');
        crossDbPanel.style.display = 'none';
        crossDbResult.style.display = 'none';
        const heatmapSection = document.getElementById('crossDbHeatmapSection');
        if (heatmapSection) heatmapSection.style.display = 'none';
        localHeader.style.display = '';
        compareContent.style.display = '';
        renderCompareView();
    });

    crossBtn.addEventListener('click', () => {
        if (!hasAdminAccess()) {
            showStatus('Datenbank-übergreifender Vergleich ist nur für Administratoren verfügbar', true);
            return;
        }
        state.crossDbMode = true;
        crossBtn.classList.add('active');
        localBtn.classList.remove('active');
        crossDbPanel.style.display = '';
        localHeader.style.display = 'none';
        compareContent.style.display = 'none';
        renderCrossDbView();
    });

    const refreshBtn = document.getElementById('crossDbRefreshBtn');
    refreshBtn.addEventListener('click', async () => {
        refreshBtn.classList.add('loading');
        try {
            // Heatmap immer aktualisieren
            if (state.crossDbSources.length >= 2) {
                await loadCrossDbHeatmapData();
            }
            // Detail-Ansicht aktualisieren wenn Lieferant ausgewählt
            if (state.crossDbSelectedSupplier) {
                await loadAndRenderCrossDbComparison();
            }
        } finally {
            refreshBtn.classList.remove('loading');
        }
    });

    addBtn.addEventListener('click', async () => {
        try {
            const path = await invoke('select_existing_db');
            if (!path) return;

            // Prüfen ob es die aktuell geöffnete Datenbank ist
            const currentPath = await invoke('get_current_db_path');
            if (normalizePath(path) === normalizePath(currentPath)) {
                showStatus('Die aktuell geöffnete Datenbank kann nicht als Vergleichs-DB hinzugefügt werden', true);
                return;
            }

            if (state.crossDbSources.some(s => normalizePath(s.path) === normalizePath(path))) {
                showStatus('Diese Datenbank ist bereits hinzugefügt', true);
                return;
            }

            const source = await invoke('validate_external_db', { path });
            state.crossDbSources.push(source);
            renderCrossDbSourceList();
            updateCrossDbSupplierDropdown();

            // Heatmap automatisch laden wenn 2+ DBs
            if (state.crossDbSources.length >= 2) {
                loadCrossDbHeatmapData();
            }
        } catch (e) {
            showStatus('Fehler: ' + e, true);
        }
    });

    // Dropdown-Toggle für Lieferant
    if (supplierInput) {
        supplierInput.addEventListener('click', () => {
            const dropdown = document.getElementById('crossDbSupplierDropdown');
            if (dropdown) dropdown.classList.toggle('visible');
        });
    }

    // Dropdown schließen bei Klick außerhalb (nur einmal registrieren)
    if (supplierWrapper && !supplierWrapper._crossDbClickHandler) {
        supplierWrapper._crossDbClickHandler = true;
        document.addEventListener('click', (e) => {
            if (!supplierWrapper.contains(e.target)) {
                const dropdown = document.getElementById('crossDbSupplierDropdown');
                if (dropdown) dropdown.classList.remove('visible');
            }
        });
    }
}

function renderCrossDbView() {
    const crossDbResult = document.getElementById('crossDbResult');
    renderCrossDbSourceList();
    updateCrossDbSupplierDropdown();

    // Heatmap anzeigen wenn 2+ DBs vorhanden
    if (state.crossDbSources.length >= 2 && state.crossDbAllEntries.length > 0) {
        renderCrossDbHeatmap();
    }

    if (state.crossDbSelectedSupplier && state.crossDbEntries.length > 0) {
        crossDbResult.style.display = '';
        renderCrossDbComparison({ sources: state.crossDbSources, entries: state.crossDbEntries });
    } else {
        crossDbResult.style.display = 'none';
    }
}

function renderCrossDbSourceList() {
    const container = document.getElementById('crossDbSourceList');
    if (!container) return;

    // Aktuelle DB immer anzeigen
    let html = '<span class="cross-db-chip current">Aktuelle DB</span>';

    state.crossDbSources.forEach((src, idx) => {
        html += `<span class="cross-db-chip">
            ${escapeHtml(src.label)}
            <button class="chip-remove" data-idx="${idx}" title="Entfernen">&times;</button>
        </span>`;
    });

    container.innerHTML = html;

    // Entfernen-Buttons verdrahten
    container.querySelectorAll('.chip-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            state.crossDbSources.splice(parseInt(btn.dataset.idx), 1);
            state.crossDbSelectedSupplier = null;
            state.crossDbEntries = [];
            state.crossDbAllEntries = [];

            // Charts aufräumen
            if (state.crossDbCategoryChartInstance) { state.crossDbCategoryChartInstance.destroy(); state.crossDbCategoryChartInstance = null; }
            if (state.crossDbTrendChartInstance) { state.crossDbTrendChartInstance.destroy(); state.crossDbTrendChartInstance = null; }

            // Heatmap und Details ausblenden
            const heatmapSection = document.getElementById('crossDbHeatmapSection');
            if (heatmapSection) heatmapSection.style.display = 'none';
            const detailCharts = document.getElementById('crossDbDetailCharts');
            if (detailCharts) detailCharts.style.display = 'none';

            renderCrossDbSourceList();
            updateCrossDbSupplierDropdown();

            // Heatmap neu laden wenn noch genug DBs
            if (state.crossDbSources.length >= 2) {
                loadCrossDbHeatmapData();
            }
            renderCrossDbView();
        });
    });
}

function updateCrossDbSupplierDropdown() {
    const selectEl = document.getElementById('crossDbSupplierSelect');
    const dropdown = document.getElementById('crossDbSupplierDropdown');
    if (!selectEl || !dropdown) return;

    if (state.crossDbSources.length === 0) {
        selectEl.style.display = 'none';
        return;
    }

    // Lieferanten zählen: in wie vielen DBs kommt jeder vor?
    const supplierDbs = {};
    const currentSuppliers = [...new Set(state.historieData.map(h => h.lieferant))];
    currentSuppliers.forEach(s => { supplierDbs[s] = (supplierDbs[s] || 0) + 1; });
    state.crossDbSources.forEach(src => {
        src.lieferanten.forEach(s => { supplierDbs[s] = (supplierDbs[s] || 0) + 1; });
    });

    // Nur Lieferanten die in mind. 2 DBs vorkommen
    const sharedSuppliers = Object.entries(supplierDbs)
        .filter(([_, count]) => count >= 2)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name));

    selectEl.style.display = '';

    if (sharedSuppliers.length === 0) {
        dropdown.innerHTML = '<div class="custom-dropdown-item disabled">Keine gemeinsamen Lieferanten gefunden</div>';
        return;
    }

    dropdown.innerHTML = sharedSuppliers.map(s => `
        <div class="custom-dropdown-item" data-value="${escapeHtml(s.name)}">
            ${escapeHtml(s.name)} <small style="opacity:0.6">(${s.count} DBs)</small>
        </div>
    `).join('');

    dropdown.querySelectorAll('.custom-dropdown-item:not(.disabled)').forEach(item => {
        item.addEventListener('click', async () => {
            state.crossDbSelectedSupplier = item.dataset.value;
            const input = document.getElementById('crossDbSupplierInput');
            if (input) input.value = item.dataset.value;
            dropdown.classList.remove('visible');
            await loadAndRenderCrossDbComparison();
        });
    });
}

async function loadAndRenderCrossDbComparison() {
    if (!state.crossDbSelectedSupplier) return;

    const externalPaths = state.crossDbSources.map(s => s.path);
    try {
        const result = await invoke('load_cross_db_historie', {
            externalPaths,
            lieferantFilter: state.crossDbSelectedSupplier,
        });
        state.crossDbEntries = result.entries;
        const crossDbResult = document.getElementById('crossDbResult');
        if (crossDbResult) crossDbResult.style.display = '';
        renderCrossDbComparison(result);
    } catch (e) {
        showStatus('Fehler beim Laden: ' + e, true);
    }
}

function renderCrossDbComparison(result) {
    // Einträge nach db_label gruppieren
    const grouped = {};
    result.entries.forEach(e => {
        if (!grouped[e.db_label]) grouped[e.db_label] = [];
        grouped[e.db_label].push(e);
    });

    const labels = Object.keys(grouped);
    const colors = [getAccentColor(), '#10b981', '#3b82f6', '#ef4444', '#8b5cf6',
                     '#06b6d4', '#ec4899', '#14b8a6', '#f43f5e', '#a855f7'];

    // Kategorien-Vergleich + Trend-Verlauf
    renderCrossDbTrendChart(grouped, labels, colors);
    loadAndRenderCrossDbCategoryChart();
    const detailCharts = document.getElementById('crossDbDetailCharts');
    if (detailCharts) detailCharts.style.display = '';

    // Heatmap-Highlight aktualisieren (ohne Neuladen)
    const heatmapTable = document.getElementById('crossDbHeatmapTable');
    if (heatmapTable) {
        heatmapTable.querySelectorAll('tr').forEach(r => {
            r.classList.toggle('selected', r.dataset.supplier === state.crossDbSelectedSupplier);
        });
    }
}

// ============================================================================
// Cross-DB Management Views: Heatmap, Kategorien, Trend
// ============================================================================

async function loadCrossDbHeatmapData() {
    if (state.crossDbSources.length < 2) return;
    try {
        const externalPaths = state.crossDbSources
            .filter(s => s.path !== '__current__')
            .map(s => s.path);
        const result = await invoke('load_cross_db_historie', {
            externalPaths,
            lieferantFilter: null,
        });
        state.crossDbAllEntries = result.entries;
        renderCrossDbHeatmap();
    } catch (e) {
        if (state.currentUser) showStatus('Fehler beim Laden der Heatmap: ' + e, true);
    }
}

function renderCrossDbHeatmap() {
    const container = document.getElementById('crossDbHeatmapTable');
    const section = document.getElementById('crossDbHeatmapSection');
    if (!container || !section) return;

    const entries = state.crossDbAllEntries;
    if (!entries || entries.length === 0) {
        section.style.display = 'none';
        return;
    }

    // Alle SE-Teams (db_labels) sammeln
    const allLabels = [...new Set(entries.map(e => e.db_label))];

    // Matrix aufbauen: lieferant → { db_label → { latest, scores[], count } }
    const matrix = {};
    entries.forEach(e => {
        if (!matrix[e.lieferant]) matrix[e.lieferant] = {};
        if (!matrix[e.lieferant][e.db_label]) {
            matrix[e.lieferant][e.db_label] = { latest: null, scores: [], count: 0 };
        }
        const cell = matrix[e.lieferant][e.db_label];
        cell.scores.push(e.ergebnis);
        cell.count++;
        if (!cell.latest || e.datum > cell.latest.datum) {
            cell.latest = e;
        }
    });

    // Nur Lieferanten die in 2+ DBs vorkommen
    const suppliers = Object.keys(matrix).filter(l => {
        return Object.keys(matrix[l]).length >= 2;
    });

    if (suppliers.length === 0) {
        section.style.display = 'none';
        return;
    }

    // Sortieren: Schlechtester Durchschnitt oben (Handlungsbedarf zuerst)
    suppliers.sort((a, b) => {
        const avgA = getOverallAvg(matrix[a]);
        const avgB = getOverallAvg(matrix[b]);
        return avgA - avgB;
    });

    function getOverallAvg(cells) {
        let total = 0, count = 0;
        Object.values(cells).forEach(c => {
            c.scores.forEach(s => { total += s; count++; });
        });
        return count > 0 ? total / count : 0;
    }

    function getScoreClass(score) {
        if (score >= state.settings.threshold_success) return 'success';
        if (score >= state.settings.threshold_warning) return 'warning';
        return 'danger';
    }

    // HTML generieren
    let html = '<table class="cross-db-heatmap"><thead><tr>';
    html += '<th>Lieferant</th>';
    allLabels.forEach(l => { html += `<th>${escapeHtml(l)}</th>`; });
    html += '<th class="cross-db-heatmap-th-summary">&#216; Gesamt</th>';
    html += '<th class="cross-db-heatmap-th-summary">Streuung</th>';
    html += '</tr></thead><tbody>';

    suppliers.forEach(supplier => {
        const cells = matrix[supplier];
        const isSelected = state.crossDbSelectedSupplier === supplier;

        html += `<tr class="${isSelected ? 'selected' : ''}" data-supplier="${escapeHtml(supplier)}">`;
        html += `<td>${escapeHtml(supplier)}</td>`;

        let allScores = [];
        allLabels.forEach(label => {
            const cell = cells[label];
            if (cell && cell.latest) {
                const score = cell.latest.ergebnis;
                const avg = cell.scores.reduce((a, b) => a + b, 0) / cell.scores.length;
                allScores.push(avg);
                const cls = getScoreClass(score);
                html += `<td title="${cell.count} Bewertung${cell.count !== 1 ? 'en' : ''}"><span class="cross-db-heatmap-dot ${cls}"></span>${score.toFixed(1)}%</td>`;
            } else {
                html += '<td><span class="cross-db-heatmap-empty">k.A.</span></td>';
            }
        });

        // Durchschnitt
        const overallAvg = getOverallAvg(cells);
        const avgClass = getScoreClass(overallAvg);
        html += `<td class="cross-db-heatmap-td-summary"><span class="cross-db-heatmap-cell ${avgClass} cross-db-heatmap-avg">${overallAvg.toFixed(1)}%</span></td>`;

        // Streuung (Delta)
        if (allScores.length >= 2) {
            const maxS = Math.max(...allScores);
            const minS = Math.min(...allScores);
            const delta = maxS - minS;
            const deltaClass = delta > 30 ? 'danger' : delta > 15 ? 'warning' : 'success';
            html += `<td class="cross-db-heatmap-td-summary"><span class="cross-db-heatmap-cell-muted ${deltaClass}">${delta.toFixed(1)} Pkt.</span></td>`;
        } else {
            html += '<td class="cross-db-heatmap-td-summary"><span class="cross-db-heatmap-empty">k.A.</span></td>';
        }

        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
    section.style.display = '';

    // Klick-Handler auf Zeilen
    container.querySelectorAll('tr[data-supplier]').forEach(row => {
        row.addEventListener('click', () => {
            const supplier = row.dataset.supplier;
            state.crossDbSelectedSupplier = supplier;

            // Dropdown synchronisieren
            const input = document.getElementById('crossDbSupplierInput');
            if (input) input.value = supplier;

            // Highlight aktualisieren
            container.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
            row.classList.add('selected');

            // Detail-Daten laden
            loadAndRenderCrossDbComparison();
        });
    });
}

function renderCrossDbTrendChart(grouped, labels, colors) {
    const canvas = document.getElementById('crossDbTrendChart');
    if (!canvas) return;

    if (state.crossDbTrendChartInstance) {
        state.crossDbTrendChartInstance.destroy();
    }

    const theme = getChartThemeColors();
    const { isDark, textColor, gridColor } = theme;

    // Daten aufbereiten: pro Label nach Datum sortieren
    const datasets = [];
    labels.forEach((label, idx) => {
        const data = grouped[label];
        if (!data || data.length === 0) return;

        const sorted = [...data].sort((a, b) => a.datum.localeCompare(b.datum));
        const color = colors[idx % colors.length];

        datasets.push({
            label: label,
            data: sorted.map(e => ({ x: e.datum, y: e.ergebnis })),
            borderColor: color,
            backgroundColor: color + '20',
            borderWidth: 2,
            fill: false,
            tension: 0.4,
            pointBackgroundColor: color,
            pointRadius: 4,
            pointHoverRadius: 6,
        });
    });

    // Alle Datumsangaben für X-Achse
    const allDates = [...new Set(
        Object.values(grouped).flatMap(g => g.map(e => e.datum))
    )].sort();

    const ctx = canvas.getContext('2d');
    state.crossDbTrendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: allDates.map(d => formatDate(d)),
            datasets: datasets.map(ds => ({
                ...ds,
                data: allDates.map(date => {
                    const point = ds.data.find(p => p.x === date);
                    return point ? point.y : null;
                })
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            spanGaps: true,
            plugins: {
                legend: {
                    display: true,
                    labels: { color: textColor, usePointStyle: true, pointStyle: 'circle' }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}%`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: gridColor },
                    ticks: { color: textColor, callback: v => v + '%' }
                },
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, maxRotation: 45 }
                }
            }
        }
    });
}

async function loadAndRenderCrossDbCategoryChart() {
    if (!state.crossDbSelectedSupplier) return;
    try {
        const externalPaths = state.crossDbSources
            .filter(s => s.path !== '__current__')
            .map(s => s.path);
        const result = await invoke('load_cross_db_category_scores', {
            externalPaths,
            lieferant: state.crossDbSelectedSupplier,
        });
        renderCrossDbCategoryChart(result);
    } catch (e) {
        console.error('Fehler beim Laden der Kategorien-Daten:', e);
    }
}

function renderCrossDbCategoryChart(result) {
    const canvas = document.getElementById('crossDbCategoryChart');
    if (!canvas) return;

    if (state.crossDbCategoryChartInstance) {
        state.crossDbCategoryChartInstance.destroy();
    }

    if (!result.entries || result.entries.length === 0) return;

    const theme = getChartThemeColors();
    const { isDark, textColor, gridColor } = theme;

    const colors = [getAccentColor(), '#10b981', '#3b82f6', '#ef4444', '#8b5cf6',
                     '#06b6d4', '#ec4899', '#14b8a6', '#f43f5e', '#a855f7'];

    // Alle Kategorien sammeln (Reihenfolge aus erster Entry)
    const allCategories = result.entries[0].categories.map(c => c.gruppe);

    // Datasets: eine pro SE-Team
    const datasets = result.entries.map((entry, idx) => ({
        label: entry.db_label,
        data: allCategories.map(cat => {
            const c = entry.categories.find(c => c.gruppe === cat);
            return c ? c.score : 0;
        }),
        backgroundColor: colors[idx % colors.length] + 'CC',
        borderColor: colors[idx % colors.length],
        borderWidth: 1,
        borderRadius: 4,
    }));

    const ctx = canvas.getContext('2d');
    state.crossDbCategoryChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: allCategories,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: { color: textColor, usePointStyle: true, pointStyle: 'rect' }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const entry = result.entries[ctx.datasetIndex];
                            return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}% (${formatDate(entry.datum)})`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: gridColor },
                    ticks: { color: textColor, callback: v => v + '%' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: textColor, maxRotation: 20 }
                }
            }
        }
    });
}

function formatDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const [year, month, day] = parts;
    return `${day}.${month}.${year}`;
}

async function loadBewertung(id) {
    try {
        const bewertung = await invoke('lade_bewertung_cmd', { id });

        if (bewertung) {
            // Handle antworten - convert old array format to new object format if needed
            if (Array.isArray(bewertung.antworten)) {
                // Old format: array indexed by frage.index
                // Use sort_index for correct mapping (handles added/reordered questions)
                state.antworten = {};
                state.fragen.forEach(f => {
                    const sortIdx = f.index;
                    state.antworten[f.id] = (sortIdx < bewertung.antworten.length && bewertung.antworten[sortIdx] !== undefined)
                        ? bewertung.antworten[sortIdx]
                        : -1;
                });
            } else {
                // New format: object with frage_id as key
                state.antworten = bewertung.antworten || {};
                // Ensure all current questions have an answer
                state.fragen.forEach(f => {
                    if (state.antworten[f.id] === undefined) {
                        state.antworten[f.id] = -1;
                    }
                });
            }

            // Handle kommentare - already object from backend
            state.kommentare = bewertung.kommentare || {};

            state.selectedDate = parseDate(bewertung.datum);
            state.datePickerMonth = new Date(state.selectedDate);

            // Mark as loaded evaluation (disable save button until date changes)
            state.isLoadedBewertung = true;
            state.loadedBewertungDate = bewertung.datum;

            // Update Lieferant dropdown (hidden ID value and visible name)
            elements.lieferantSelect.value = bewertung.lieferant_id || '';
            elements.lieferantInput.value = bewertung.lieferant;

            elements.seTeamInput.value = bewertung.se_team || '';
            elements.bestellnummerInput.value = bewertung.bestellnummer || '';
            autoResizeBestellnummer();
            elements.massnahmenInput.value = bewertung.massnahmen || '';
            updateMassnahmenIndicator();
            // Open panel if there's content
            if (bewertung.massnahmen && bewertung.massnahmen.trim()) {
                openMassnahmenPanel();
            } else {
                closeMassnahmenPanel();
            }
            updateDateDisplay();

            renderQuestions();
            updateProgress();
            updateResult();

            switchView('bewertung');
            showStatus('Bewertung geladen – Datum ändern um neu zu speichern', false);
        }
    } catch (e) {
        showStatus('Fehler beim Laden: ' + e, true);
    }
}

async function editBewertung(id) {
    try {
        const bewertung = await invoke('lade_bewertung_cmd', { id });

        if (bewertung) {
            state.editId = id;
            state.editBewertung = bewertung;

            elements.editLieferant.textContent = bewertung.lieferant;
            elements.editSeTeam.textContent = bewertung.se_team || '-';
            elements.editDatum.textContent = formatDate(bewertung.datum);
            elements.editErgebnis.textContent = bewertung.ergebnis.toFixed(1) + '%';
            elements.editBestellnummer.value = bewertung.bestellnummer || '';
            // Resize after modal is visible (setTimeout ensures proper rendering)
            setTimeout(() => autoResizeTextarea(elements.editBestellnummer), 50);

            // Get unique group names from current questions
            const groupNames = [...new Set(state.fragen.map(f => f.gruppe))];
            const kommentare = bewertung.kommentare || {};

            // Generate dynamic comment fields
            let html = '';
            groupNames.forEach(groupName => {
                const kommentar = kommentare[groupName] || '';
                const safeGroupName = groupName.replace(/"/g, '&quot;');
                html += `
                    <div class="modal-field">
                        <label>Bemerkung: ${escapeHtml(groupName)}</label>
                        <textarea class="edit-kommentar-field" data-group="${safeGroupName}" placeholder="Bemerkung eingeben...">${escapeHtml(kommentar)}</textarea>
                    </div>
                `;
            });

            // Add Maßnahmen field
            const massnahmen = bewertung.massnahmen || '';
            html += `
                <div class="modal-field massnahmen-field">
                    <label>Maßnahmen für nächstes Quartal</label>
                    <textarea id="editMassnahmen" placeholder="Vereinbarte Maßnahmen...">${escapeHtml(massnahmen)}</textarea>
                </div>
            `;

            elements.editKommentareContainer.innerHTML = html;

            showModal('editModal');
        }
    } catch (e) {
        showStatus('Fehler beim Laden: ' + e, true);
    }
}

async function saveEditBewertung() {
    if (!state.editId || !state.editBewertung) return;

    // Collect comments from dynamic fields
    const kommentare = {};
    document.querySelectorAll('.edit-kommentar-field').forEach(textarea => {
        const groupName = textarea.dataset.group;
        kommentare[groupName] = textarea.value;
    });

    // Get Maßnahmen from edit modal
    const editMassnahmenField = document.getElementById('editMassnahmen');
    const massnahmen = editMassnahmenField ? editMassnahmenField.value.trim() : '';

    // Get Bestellnummer from edit modal
    const bestellnummer = elements.editBestellnummer ? elements.editBestellnummer.value.trim() : '';

    const bewertung = {
        ...state.editBewertung,
        id: state.editId,
        kommentare: kommentare,
        massnahmen: massnahmen,
        bestellnummer: bestellnummer
    };

    try {
        // Bewertung aktualisieren (Admin, Controlling)
        await invoke('aktualisiere_bewertung_cmd', { bewertung });

        hideModal('editModal');
        state.editId = null;
        state.editBewertung = null;
        loadHistorie();
        showStatus('Bewertung aktualisiert', false);
    } catch (e) {
        showStatus('Fehler beim Speichern: ' + e, true);
    }
}

function confirmDeleteBewertung(id) {
    state.deleteId = id;
    showModal('deleteModal');
}

async function deleteBewertung() {
    if (!state.deleteId || state.isDeleting) return;
    state.isDeleting = true;

    try {
        await invoke('loesche_bewertung_cmd', { id: state.deleteId });
        hideModal('deleteModal');

        // Reset loaded state - die gelöschte Bewertung ist nicht mehr gültig
        resetLoadedState();

        state.deleteId = null;
        loadHistorie();
        loadDashboard(); // Dashboard aktualisieren
        showStatus('Bewertung gelöscht', false);
    } catch (e) {
        showStatus('Fehler beim Löschen: ' + e, true);
    } finally {
        state.isDeleting = false;
    }
}

// ============================================================================
// Utilities
// ============================================================================
function showModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('visible');

    if (id === 'lieferantModal') {
        setTimeout(() => elements.newLieferantInput.focus(), 100);
    }
}

function hideModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('visible');
}

function hideAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('visible'));
}

function normalizePath(p) {
    return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

function showStatus(message, isError) {
    elements.statusMessage.textContent = message;
    elements.statusMessage.className = 'status-message ' + (isError ? 'error' : 'success');

    setTimeout(() => {
        elements.statusMessage.textContent = '';
        elements.statusMessage.className = 'status-message';
    }, 5000);

    // Also show toast notification
    showToast(message, isError ? 'error' : 'success');
}

function showToast(message, type = 'info', duration = 6000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    toast.innerHTML = (icons[type] || icons.info) + `<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastSlideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function showError(message) {
    elements.errorMessage.textContent = message;
    showModal('errorModal');
}

function showConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);

    const colors = [getAccentColor(), '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];
    const shapes = ['circle', 'square', 'triangle'];
    const confettiCount = 80 + Math.floor(Math.random() * 40);

    for (let i = 0; i < confettiCount; i++) {
        const confetti = document.createElement('div');
        const shape = shapes[Math.floor(Math.random() * shapes.length)];
        confetti.className = `confetti ${shape}`;

        const color = colors[Math.floor(Math.random() * colors.length)];
        if (shape === 'triangle') {
            confetti.style.borderBottomColor = color;
        } else {
            confetti.style.backgroundColor = color;
        }

        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.top = -20 + 'px';
        confetti.style.animationDelay = Math.random() * 0.5 + 's';
        confetti.style.animationDuration = (2 + Math.random() * 2) + 's';

        const size = 6 + Math.random() * 8;
        if (shape !== 'triangle') {
            confetti.style.width = size + 'px';
            confetti.style.height = size + 'px';
        }

        container.appendChild(confetti);
    }

    setTimeout(() => {
        container.remove();
    }, 4000);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';

    // Smooth transition
    document.documentElement.classList.add('theme-transitioning');
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);

    setTimeout(() => {
        document.documentElement.classList.remove('theme-transitioning');
    }, 400);

    // Re-render visible charts with new theme colors
    if (state.dashboardDonutChartInstance && state.currentUser) {
        loadDashboard();
    }
}

function toggleSidebar() {
    const sidebar = elements.sidebar;
    if (!sidebar) return;
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
}

function showAbout() {
    elements.appVersion.textContent = APP_VERSION;
    showModal('aboutModal');
}

// ============================================================================
// Login Functions
// ============================================================================
function toggleLogin() {
    if (state.currentUser) {
        // Logged in: show dropdown with logout option
        const dd = elements.loginDropdown;
        dd.classList.toggle('visible');
        if (dd.classList.contains('visible')) renderLoginDropdown();
    } else {
        // Not logged in: open login modal directly
        elements.loginUsername.value = '';
        elements.loginPassword.value = '';
        elements.loginError.textContent = '';
        showModal('loginModal');
    }
}

function renderLoginDropdown() {
    const dd = elements.loginDropdown;
    dd.innerHTML = '';

    if (state.currentUser) {
        // Logged in: username header + logout item
        const header = document.createElement('div');
        header.className = 'login-dropdown-header';
        header.textContent = state.currentUser.username;
        dd.appendChild(header);

        const logoutItem = document.createElement('div');
        logoutItem.className = 'login-dropdown-item';
        logoutItem.textContent = 'Abmelden';
        logoutItem.addEventListener('click', (e) => {
            e.stopPropagation();
            dd.classList.remove('visible');
            doLogout();
        });
        dd.appendChild(logoutItem);
    } else {
        // Not logged in: login item
        const loginItem = document.createElement('div');
        loginItem.className = 'login-dropdown-item';
        loginItem.textContent = 'Login';
        loginItem.addEventListener('click', (e) => {
            e.stopPropagation();
            dd.classList.remove('visible');
            elements.loginUsername.value = '';
            elements.loginPassword.value = '';
            elements.loginError.textContent = '';
            showModal('loginModal');
        });
        dd.appendChild(loginItem);
    }
}

function showPasswordModal() {
    elements.oldPassword.value = '';
    elements.newPassword.value = '';
    elements.confirmPassword.value = '';
    elements.passwordError.textContent = '';
    showModal('passwordModal');
}

async function doLogin() {
    if (state.isLoggingIn) return;
    const username = elements.loginUsername.value.trim();
    const password = elements.loginPassword.value;

    if (!username || !password) {
        elements.loginError.textContent = 'Bitte Benutzername und Passwort eingeben';
        return;
    }

    state.isLoggingIn = true;
    try {
        const user = await invoke('login_cmd', { username, password });

        if (user) {
            state.currentUser = user;
            elements.loginStatus.textContent = user.username;
            elements.loginStatus.classList.add('visible');
            elements.loginToggle.title = 'Abmelden';
            hideModal('loginModal');

            // Check if default password is being used (security warning via backend)
            try {
                const isDefault = await invoke('check_default_password', { username });
                if (isDefault) {
                    showConfirmDialog(
                        'Sicherheitswarnung',
                        'Sie verwenden noch das Standard-Passwort. Bitte ändern Sie es umgehend für mehr Sicherheit.',
                        () => {
                            showPasswordModal();
                        },
                        'Jetzt ändern',
                        false // not danger, just warning
                    );
                } else {
                    showStatus(`Willkommen, ${user.username}!`, false);
                }
            } catch (e) {
                showStatus(`Willkommen, ${user.username}!`, false);
            }

            // Nach Login: Alle Daten parallel neu laden (Auth-Guards erfordern Login)
            await Promise.all([
                loadLieferanten(),
                loadSeTeams(),
                loadFragen(),
                loadGruppen(),
                loadSettings(),
                loadDbPath(),
            ]);

            // Toggle admin UI
            applyRoleVisibility(user);
            // Re-render questions to show admin controls
            renderQuestions();
            // Re-render historie to update delete button state
            loadHistorie();
            // Dashboard laden
            loadDashboard();

            // Phase 2: Überfällige Maßnahmen prüfen
            try {
                const updated = await invoke('check_ueberfaellige_massnahmen_cmd');
                if (updated > 0) {
                    showToast(`${updated} Maßnahme${updated !== 1 ? 'n' : ''} als überfällig markiert`, 'warning');
                }
            } catch (e) {
                console.warn('Fehler bei Fälligkeitsprüfung:', e);
            }
        } else {
            elements.loginError.textContent = 'Ungültiger Benutzername oder Passwort';
        }
    } catch (e) {
        elements.loginError.textContent = 'Fehler beim Login: ' + e;
    } finally {
        state.isLoggingIn = false;
    }
}

function doLogout() {
    invoke('logout_cmd').catch(e => console.error('Logout error:', e));
    state.currentUser = null;
    elements.loginStatus.textContent = '';
    elements.loginStatus.classList.remove('visible');
    elements.loginToggle.title = 'Login';
    resetRoleVisibility();

    // ---- Kompletter UI-Reset ----

    // Bewertungsformular zurücksetzen
    resetBewertung(true);

    // Historie / Trend / Vergleich zurücksetzen
    state.historieData = [];
    state.historie = [];
    state.historiePage = 1;
    state.currentHistorieView = 'table';
    state.selectedTrendLieferant = null;
    state.selectedCompare1 = null;
    state.selectedCompare2 = null;
    state.multiSelectLieferanten = ['__average__'];
    if (elements.historieBody) elements.historieBody.innerHTML = '';

    // Chart-Instanzen zerstören
    if (state.trendLineChartInstance) { state.trendLineChartInstance.destroy(); state.trendLineChartInstance = null; }
    if (state.trendBarChartInstance) { state.trendBarChartInstance.destroy(); state.trendBarChartInstance = null; }
    if (state.kategorieTrendChartInstance) { state.kategorieTrendChartInstance.destroy(); state.kategorieTrendChartInstance = null; }
    if (state.compareRadarChartInstance) { state.compareRadarChartInstance.destroy(); state.compareRadarChartInstance = null; }
    if (state.dashboardDonutChartInstance) { state.dashboardDonutChartInstance.destroy(); state.dashboardDonutChartInstance = null; }
    if (state.crossDbCategoryChartInstance) { state.crossDbCategoryChartInstance.destroy(); state.crossDbCategoryChartInstance = null; }
    if (state.crossDbTrendChartInstance) { state.crossDbTrendChartInstance.destroy(); state.crossDbTrendChartInstance = null; }

    // Dashboard zurücksetzen
    state.dashboardData = null;
    state.dashboardTimeframe = 'quarter';
    state.dashboardCustomStart = null;
    state.dashboardCustomEnd = null;

    // Cross-DB zurücksetzen
    state.crossDbMode = false;
    state.crossDbSources = [];
    state.crossDbEntries = [];
    state.crossDbAllEntries = [];
    state.crossDbSelectedSupplier = null;

    // Ziele zurücksetzen
    state.zieleData = [];
    state.editZielId = null;

    // Zur Dashboard-View wechseln (leerer Zustand)
    switchView('dashboard');

    showStatus('Abgemeldet', false);

    // Login-Dialog automatisch öffnen
    elements.loginUsername.value = '';
    elements.loginPassword.value = '';
    elements.loginError.textContent = '';
    showModal('loginModal');
}

// ============================================================================
// Database Switching (Admin only)
// ============================================================================
async function switchDatabaseDialog() {
    if (!state.currentUser || !(state.currentUser.role === 'admin' || state.currentUser.role === 'controlling')) {
        showStatus('Nur Administratoren oder Controlling dürfen die Datenbank wechseln', true);
        return;
    }

    try {
        // Show file picker for existing database
        const selectedPath = await invoke('select_existing_db');

        if (selectedPath) {
            // Confirm switch
            const currentPath = await invoke('get_current_db_path');

            showConfirmDialog(
                'Datenbank wechseln',
                `Aktuell: ${currentPath}\nNeu: ${selectedPath}`,
                async () => {
                    try {
                        // Switch database
                        const newPath = await invoke('switch_database', { path: selectedPath });
                        showStatus(`Datenbank gewechselt: ${newPath}`, false);

                        // Session zurücksetzen und Login-Dialog anzeigen
                        state.currentUser = null;
                        elements.loginStatus.textContent = '';
                        elements.loginStatus.classList.remove('visible');
                        elements.loginToggle.title = 'Login';
                        resetRoleVisibility();

                        // Reload all data
                        await reloadAllData();

                        // Login-Dialog automatisch öffnen
                        elements.loginUsername.value = '';
                        elements.loginPassword.value = '';
                        elements.loginError.textContent = '';
                        showModal('loginModal');
                    } catch (e) {
                        showStatus('Fehler beim Wechseln: ' + e, true);
                    }
                },
                'Wechseln',
                false
            );
        }
    } catch (e) {
        showStatus('Fehler: ' + e, true);
    }
}

// Switch database from login dialog (no login required - for recovery)
async function switchDatabaseFromLogin() {
    try {
        // Show file picker for existing database
        const selectedPath = await invoke('select_existing_db');

        if (selectedPath) {
            hideModal('loginModal');

            try {
                // Switch database (no login required for this)
                await invoke('set_db_path', { path: selectedPath });
                await invoke('switch_database', { path: selectedPath });

                showStatus(`Datenbank gewechselt: ${selectedPath}`, false);

                // Reset state
                state.currentUser = null;
                elements.loginStatus.textContent = '';
                elements.loginStatus.classList.remove('visible');
                elements.loginToggle.title = 'Login';
                resetRoleVisibility();

                // Show login dialog for new database
                elements.loginUsername.value = '';
                elements.loginPassword.value = '';
                elements.loginError.textContent = '';
                showModal('loginModal');
            } catch (e) {
                showStatus('Fehler beim Wechseln: ' + e, true);
                // Re-open login dialog
                showModal('loginModal');
            }
        }
    } catch (e) {
        showStatus('Fehler: ' + e, true);
    }
}

async function factoryResetDialog() {
    if (!state.currentUser || state.currentUser.role !== 'admin') {
        showStatus('Nur Administratoren können einen Factory Reset durchführen', true);
        return;
    }

    showConfirmDialog(
        'Factory Reset',
        'ACHTUNG: Alle Daten werden unwiderruflich gelöscht!\n\nDies umfasst:\n• Alle Bewertungen\n• Alle Lieferanten\n• Alle Benutzer\n• Alle Einstellungen\n\nDie Anwendung wird danach neu gestartet.',
        async () => {
            try {
                showStatus('Factory Reset wird durchgeführt...', false);
                await invoke('factory_reset');
                showStatus('Factory Reset erfolgreich - Anwendung wird neu geladen...', false);

                // Reload the application after a short delay
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            } catch (e) {
                showStatus('Fehler beim Factory Reset: ' + e, true);
            }
        },
        'Alles löschen',
        true
    );
}

async function reloadAllData() {
    // Reset state
    state.antworten = {};
    state.kommentare = {};
    state.historieData = [];

    // Reload all data from new database
    await loadLieferanten();
    await loadSeTeams();
    await loadFragen();
    await loadGruppen();
    await loadDbPath();

    // Re-render UI
    renderQuestions();
    updateProgress();
    renderLieferantenSelect();
    renderSeTeamDropdown();

    // Reload historie if on that view
    if (document.querySelector('.sidebar-nav-btn[data-view="historie"]').classList.contains('active')) {
        await loadHistorie();
    }

    showStatus('Alle Daten neu geladen', false);
}

async function changePassword() {
    const oldPw = elements.oldPassword.value;
    const newPw = elements.newPassword.value;
    const confirmPw = elements.confirmPassword.value;

    if (!oldPw || !newPw || !confirmPw) {
        elements.passwordError.textContent = 'Bitte alle Felder ausfüllen';
        return;
    }

    if (newPw !== confirmPw) {
        elements.passwordError.textContent = 'Die neuen Passwörter stimmen nicht überein';
        return;
    }

    if (newPw.length < 8) {
        elements.passwordError.textContent = 'Das neue Passwort muss mindestens 8 Zeichen lang sein';
        return;
    }

    if (!state.currentUser) {
        elements.passwordError.textContent = 'Nicht eingeloggt';
        return;
    }

    try {
        const success = await invoke('change_password_cmd', {
            username: state.currentUser.username,
            oldPassword: oldPw,
            newPassword: newPw
        });

        if (success) {
            hideModal('passwordModal');
            elements.oldPassword.value = '';
            elements.newPassword.value = '';
            elements.confirmPassword.value = '';
            elements.passwordError.textContent = '';
            showStatus('Passwort erfolgreich geändert', false);
        } else {
            elements.passwordError.textContent = 'Aktuelles Passwort ist falsch';
        }
    } catch (e) {
        elements.passwordError.textContent = 'Fehler: ' + e;
    }
}

// ============================================================================
// Admin: Fragen-Verwaltung
// ============================================================================
function renderFrageGruppeDropdown() {
    let html = state.gruppen
        .map(g => `<div class="custom-dropdown-item" data-value="${escapeHtml(g)}">${escapeHtml(g)}</div>`)
        .join('');

    // Add option for new group
    html += '<div class="custom-dropdown-item custom-dropdown-item-new" data-value="__new__">+ Neue Gruppe erstellen...</div>';

    elements.frageGruppeDropdown.innerHTML = html;

    // Add click listeners for dropdown items
    elements.frageGruppeDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const value = item.dataset.value;
            elements.frageGruppe.value = value;
            elements.frageGruppeInput.value = value === '__new__' ? '+ Neue Gruppe erstellen...' : value;
            elements.frageGruppeDropdown.classList.remove('visible');
        });
    });
}

function showAddFrageModal() {
    // Render groups dropdown
    renderFrageGruppeDropdown();

    // Reset values
    elements.frageGruppe.value = state.gruppen[0] || '';
    elements.frageGruppeInput.value = state.gruppen[0] || '';
    elements.frageText.value = '';
    document.getElementById('frageGewichtung').value = '1';
    elements.fragePosition.value = '';
    elements.frageModalTitle.textContent = 'Neue Frage hinzufügen';
    showModal('frageModal');
}

function showEditFrageModal(frageId) {
    const frage = state.fragen.find(f => f.id === frageId);
    if (!frage) return;

    state.editFrageId = frageId;
    elements.editFrageText.value = frage.text;
    document.getElementById('editFrageGewichtung').value = frage.gewichtung || 1;
    showModal('editFrageModal');
}

async function addFrage() {
    let gruppe = elements.frageGruppe.value;
    const text = elements.frageText.value.trim();
    const positionStr = elements.fragePosition.value.trim();
    const gewichtung = parseInt(document.getElementById('frageGewichtung').value) || 1;

    if (!gruppe) {
        showStatus('Bitte eine Gruppe auswählen', true);
        return;
    }

    if (!text) {
        showStatus('Bitte Frage-Text eingeben', true);
        return;
    }

    if (gruppe === '__new__') {
        // Show prompt dialog for new group name
        showPromptDialog('Neue Gruppe erstellen', 'Name der Gruppe', async (gruppenName) => {
            if (!gruppenName) {
                showStatus('Gruppenname erforderlich', true);
                return;
            }
            await saveFrageWithGruppe(gruppenName, text, positionStr, gewichtung);
        });
        return;
    }

    await saveFrageWithGruppe(gruppe, text, positionStr, gewichtung);
}

async function saveFrageWithGruppe(gruppe, text, positionStr, gewichtung) {
    const frage = {
        text: text,
        gruppe: gruppe,
        gewichtung: gewichtung,
        position: positionStr ? parseInt(positionStr) - 1 : null
    };

    try {
        await invoke('add_frage_cmd', { frage });
        hideModal('frageModal');
        await loadFragen();
        await loadGruppen();
        renderQuestions();
        updateProgress();
        updateResult();
        showStatus('Frage hinzugefügt', false);
    } catch (e) {
        showStatus('Fehler: ' + e, true);
    }
}

async function saveFrage() {
    if (!state.editFrageId) return;

    const text = elements.editFrageText.value.trim();
    const gewichtung = parseInt(document.getElementById('editFrageGewichtung').value) || 1;
    
    if (!text) {
        showStatus('Bitte Frage-Text eingeben', true);
        return;
    }

    try {
        await invoke('update_frage_cmd', { id: state.editFrageId, text, gewichtung });
        hideModal('editFrageModal');
        state.editFrageId = null;
        await loadFragen();
        renderQuestions();
        updateProgress(); // Also update result in case weights changed current calculation
        updateResult();
        showStatus('Frage aktualisiert', false);
    } catch (e) {
        showStatus('Fehler: ' + e, true);
    }
}

async function deleteFrage() {
    if (!state.editFrageId) return;

    const frageId = state.editFrageId;
    hideModal('editFrageModal');

    showConfirmDialog(
        'Frage löschen',
        'Möchten Sie diese Frage wirklich löschen?',
        async () => {
            try {
                await invoke('delete_frage_cmd', { id: frageId });
                state.editFrageId = null;

                // Remove answer for deleted question
                delete state.antworten[frageId];

                await loadFragen();
                await loadGruppen();
                renderQuestions();
                updateProgress();
                updateResult();
                showStatus('Frage gelöscht', false);
            } catch (e) {
                showStatus('Fehler: ' + e, true);
            }
        },
        'Löschen',
        true
    );
}

// Make functions available globally for inline onclick handlers
window.loadBewertung = loadBewertung;
window.editBewertung = editBewertung;
window.confirmDeleteBewertung = confirmDeleteBewertung;
window.exportPdf = exportPdf;
window.showKpiModal = showKpiModal;

// ============================================================================
// PDF Export
// ============================================================================
let currentPdfBewertung = null;

async function exportPdf(id) {
    try {
        const bewertung = await invoke('lade_bewertung_cmd', { id });
        if (bewertung) {
            currentPdfBewertung = bewertung;
            renderPdfPreview(bewertung);
            showModal('pdfModal');
        }
    } catch (e) {
        showStatus('Fehler beim Laden der Bewertung: ' + e, true);
    }
}

function renderPdfPreview(bewertung) {
    // Header info
    elements.pdfDatum.textContent = formatDate(bewertung.datum);
    elements.pdfBerichtNr.textContent = `SEVALSystem-${bewertung.id || 'NEU'}`;
    elements.pdfLieferant.textContent = bewertung.lieferant;
    elements.pdfSeTeam.textContent = bewertung.se_team || '-';
    // Format bestellnummer - show each on new line if comma-separated
    const bestellnummer = bewertung.bestellnummer || '-';
    if (bestellnummer.includes(',')) {
        elements.pdfBestellnummer.textContent = bestellnummer.split(',').map(s => s.trim()).join('\n');
    } else {
        elements.pdfBestellnummer.textContent = bestellnummer;
    }

    // Result with color
    const ergebnis = bewertung.ergebnis.toFixed(1);
    elements.pdfErgebnis.textContent = ergebnis + '%';

    const resultBox = elements.pdfErgebnis.closest('.pdf-result-box');
    resultBox.classList.remove('warning', 'danger');
    if (bewertung.ergebnis < state.settings.threshold_warning) {
        resultBox.classList.add('danger');
    } else if (bewertung.ergebnis < state.settings.threshold_success) {
        resultBox.classList.add('warning');
    }

    // Draw chart
    drawPdfChart(bewertung);

    // Render details table
    renderPdfDetails(bewertung);

    // Render comments
    renderPdfComments(bewertung);

    // Render Maßnahmen
    renderPdfMassnahmen(bewertung);

    // Footer date
    const now = new Date();
    elements.pdfFooterDate.textContent = `Erstellt am ${formatDateDisplay(now)}`;
}

function drawPdfChart(bewertung) {
    const canvas = elements.pdfChart;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const canvasWidth = 400;
    const canvasHeight = 180;

    // Set canvas size for high DPI
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = canvasWidth + 'px';
    canvas.style.height = canvasHeight + 'px';
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Calculate results per group
    const groups = {};
    state.fragen.forEach(f => {
        if (!groups[f.gruppe]) {
            groups[f.gruppe] = { total: 0, score: 0, count: 0 };
        }
    });

    state.fragen.forEach(f => {
        // Support both old array format and new object format
        const answer = Array.isArray(bewertung.antworten)
            ? bewertung.antworten[f.index]
            : bewertung.antworten[f.id];
        
        const weight = f.gewichtung || 1;

        if (answer !== undefined && answer !== -1) {
            groups[f.gruppe].count++;
            groups[f.gruppe].total += 100 * weight;
            if (answer === 2) groups[f.gruppe].score += 100 * weight;
            else if (answer === 1) groups[f.gruppe].score += 50 * weight;
        }
    });

    const groupNames = Object.keys(groups);
    const groupResults = groupNames.map(name => {
        const g = groups[name];
        return g.total > 0 ? (g.score / g.total) * 100 : 0;
    });

    // Colors for bars (Amber palette)
    const colors = [getAccentColor(), '#d97706', '#b45309'];

    // Draw bar chart
    const barWidth = 100;
    const barSpacing = 20;
    const maxHeight = 120;
    const startX = 30;
    const startY = 160;

    groupNames.forEach((name, i) => {
        const x = startX + i * (barWidth + barSpacing);
        const height = (groupResults[i] / 100) * maxHeight;
        const y = startY - height;

        // Bar background (light gray)
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(x, startY - maxHeight, barWidth, maxHeight);

        // Bar fill with gradient
        const gradient = ctx.createLinearGradient(x, y, x, startY);
        gradient.addColorStop(0, colors[i % colors.length]);
        gradient.addColorStop(1, adjustColor(colors[i % colors.length], -20));
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, barWidth, height);

        // Percentage text on bar
        ctx.fillStyle = '#1a1a2e';
        ctx.font = 'bold 14px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(groupResults[i].toFixed(1) + '%', x + barWidth / 2, y - 8);
    });

    // Clear legend (colors are shown in group headers)
    elements.pdfChartLegend.innerHTML = '';
}

function adjustColor(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + amount));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
    const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
    return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
}

function renderPdfDetails(bewertung) {
    const groups = {};
    state.fragen.forEach(f => {
        if (!groups[f.gruppe]) groups[f.gruppe] = [];
        groups[f.gruppe].push(f);
    });

    // Colors matching the bar chart (Amber palette)
    const headerColors = [getAccentColor(), '#d97706', '#b45309'];

    // Get group names in consistent order
    const groupNames = Object.keys(groups);

    // Helper to get answer - supports both array and object format
    const getAnswer = (f) => {
        return Array.isArray(bewertung.antworten)
            ? bewertung.antworten[f.index]
            : bewertung.antworten[f.id];
    };

    let html = '';
    groupNames.forEach((groupName, groupIndex) => {
        const fragen = groups[groupName];
        const headerColor = headerColors[groupIndex % headerColors.length];

        // Calculate group score
        let groupScore = 0;
        let groupTotal = 0;
        fragen.forEach((f, localIdx) => {
            const answer = getAnswer(f);
            const weight = f.gewichtung || 1;

            if (answer !== undefined && answer !== -1) {
                groupTotal += 100 * weight;
                if (answer === 2) groupScore += 100 * weight;
                else if (answer === 1) groupScore += 50 * weight;
            }
        });
        const groupPercent = groupTotal > 0 ? (groupScore / groupTotal) * 100 : 0;

        html += `<div class="pdf-detail-group">`;
        html += `<div class="pdf-detail-group-header" style="background: ${headerColor};">
            <span>${escapeHtml(groupName)}</span>
            <span>${groupPercent.toFixed(1)}%</span>
        </div>`;

        fragen.forEach((f, localIdx) => {
            const answer = getAnswer(f);
            let answerText = 'Keine Angabe';
            let answerClass = 'keine-angabe';

            if (answer === 2) {
                answerText = 'Erfüllt';
                answerClass = 'erfuellt';
            } else if (answer === 1) {
                answerText = 'Teilweise erfüllt';
                answerClass = 'teilweise';
            } else if (answer === 0) {
                answerText = 'Nicht erfüllt';
                answerClass = 'nicht-erfuellt';
            }

            html += `<div class="pdf-detail-row">
                <span class="pdf-detail-question">${escapeHtml(f.text)}</span>
                <span class="pdf-detail-answer ${answerClass}">${answerText}</span>
            </div>`;
        });

        html += `</div>`;
    });

    elements.pdfDetailsTable.innerHTML = html;
}

function renderPdfComments(bewertung) {
    const rawKommentare = bewertung.kommentare || {};
    const groupNames = Object.keys(
        state.fragen.reduce((acc, f) => { acc[f.gruppe] = true; return acc; }, {})
    );

    let commentEntries = [];
    for (const groupName of groupNames) {
        const kommentar = rawKommentare[groupName];
        if (kommentar && kommentar.trim()) {
            commentEntries.push({
                label: groupName,
                text: kommentar
            });
        }
    }

    if (commentEntries.length === 0) {
        elements.pdfCommentsSection.style.display = 'none';
        return;
    }

    elements.pdfCommentsSection.style.display = 'block';
    let html = '';

    commentEntries.forEach(entry => {
        html += `<div class="pdf-comment-box">
            <div class="pdf-comment-label">${escapeHtml(entry.label)}</div>
            <div class="pdf-comment-text">${escapeHtml(entry.text)}</div>
        </div>`;
    });

    elements.pdfComments.innerHTML = html;
}

function renderPdfMassnahmen(bewertung) {
    const massnahmen = bewertung.massnahmen || '';

    if (!massnahmen.trim()) {
        elements.pdfMassnahmenSection.style.display = 'none';
        const headingEl = elements.pdfMassnahmenSection.querySelector('h3');
        if (headingEl) headingEl.textContent = 'Maßnahmen für nächstes Quartal';
        elements.pdfMassnahmenSection.dataset.status = '';
        return;
    }

    const meta = deriveMassnahmenMetadata(massnahmen);
    const headingEl = elements.pdfMassnahmenSection.querySelector('h3');
    if (headingEl) headingEl.textContent = meta.title;

    elements.pdfMassnahmenSection.style.display = 'block';
    elements.pdfMassnahmenSection.dataset.status = meta.status || '';
    elements.pdfMassnahmen.innerHTML = `<div class="pdf-massnahmen-text">${escapeHtml(massnahmen)}</div>`;
}

function deriveMassnahmenMetadata(text) {
    const normalized = text.trim();
    const containsResolved = /\[vq-maßnahmen\s+umgesetzt\]/i.test(normalized);
    const containsOpen = /\[vq-maßnahmen\s+nicht\s+umgesetzt\]/i.test(normalized);
    const cleaned = normalized.replace(/\[vq-maßnahmen\s+(?:umgesetzt|nicht\s+umgesetzt)\]/gi, '').trim();

    if (containsResolved && !containsOpen && cleaned.length === 0) {
        return {
            status: 'resolved',
            title: 'Rückblick Maßnahmenstatus',
            badgeLabel: 'ERGEBNIS VORQUARTAL',
            colors: {
                fill: [222, 247, 236],
                stroke: [34, 197, 94],
                label: [22, 101, 52]
            }
        };
    }

    if (containsOpen && !containsResolved && cleaned.length === 0) {
        return {
            status: 'open',
            title: 'Maßnahmenstatus offen',
            badgeLabel: 'STATUS VORQUARTAL',
            colors: {
                fill: [254, 226, 226],
                stroke: [220, 38, 38],
                label: [153, 27, 27]
            }
        };
    }

    if (containsResolved || containsOpen) {
        return {
            status: 'mixed',
            title: 'Maßnahmen und Status',
            badgeLabel: 'STATUS & PLANUNG',
            colors: {
                fill: [254, 243, 199],
                stroke: [217, 119, 6],
                label: [146, 64, 14]
            }
        };
    }

    return {
        status: 'planned',
        title: 'Maßnahmen für nächstes Quartal',
        badgeLabel: 'GEPLANTE MASSNAHMEN',
        colors: {
            fill: [254, 243, 199],
            stroke: [217, 119, 6],
            label: [146, 64, 14]
        }
    };
}

async function generatePdf() {
    if (!currentPdfBewertung) {
        showStatus('Keine Bewertung zum Exportieren', true);
        return;
    }

    showStatus('PDF wird erstellt...', false);

    try {
        // Generate default filename
        const datum = currentPdfBewertung.datum.replace(/-/g, '');
        const lieferant = currentPdfBewertung.lieferant.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '_');
        const defaultFilename = `SEVALSystem_${lieferant}_${datum}.pdf`;

        // Create PDF with jsPDF
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 15;
        const contentWidth = pageWidth - 2 * margin;
        let yPos = margin;
        let pageNum = 1;

        // Helper function to check and add new page
        const checkNewPage = (neededHeight) => {
            if (yPos + neededHeight > pageHeight - margin - 10) {
                // Add page number to current page
                addPageNumber(pdf, pageNum, pageWidth, pageHeight);
                pdf.addPage();
                pageNum++;
                yPos = margin;
                return true;
            }
            return false;
        };

        // Helper function to add page number
        const addPageNumber = (doc, num, width, height) => {
            doc.setFontSize(9);
            doc.setTextColor(150);
            doc.text(`Seite ${num}`, width / 2, height - 8, { align: 'center' });
        };

        // ===== HEADER =====
        // Logo
        if (state.pdfLogoBase64) {
            // Logo aspect ratio 935:279 ≈ 3.35:1
            const logoHeight = 12;
            const logoWidth = logoHeight * 3.35;
            pdf.addImage(state.pdfLogoBase64, 'PNG', margin, yPos, logoWidth, logoHeight);
        }

        // Meta info (right side)
        pdf.setFontSize(9);
        pdf.setTextColor(148, 163, 184);
        pdf.text('Bewertungsdatum', pageWidth - margin, yPos + 3, { align: 'right' });
        pdf.setFontSize(11);
        pdf.setTextColor(30, 41, 59);
        pdf.setFont('helvetica', 'bold');
        pdf.text(formatDate(currentPdfBewertung.datum), pageWidth - margin, yPos + 8, { align: 'right' });

        pdf.setFontSize(9);
        pdf.setTextColor(148, 163, 184);
        pdf.setFont('helvetica', 'normal');
        pdf.text('Berichts-Nr.', pageWidth - margin, yPos + 14, { align: 'right' });
        pdf.setFontSize(11);
        pdf.setTextColor(30, 41, 59);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`SEVALSystem-${currentPdfBewertung.id || 'NEU'}`, pageWidth - margin, yPos + 19, { align: 'right' });

        // Blue line under header
        yPos += 25;
        pdf.setDrawColor(217, 119, 6);
        pdf.setLineWidth(0.8);
        pdf.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 10;

        // ===== INFO BOXES =====
        const boxGap = 4;
        const boxWidth = (contentWidth - 3 * boxGap) / 4;
        const boxHeight = 18;

        // Lieferant box
        pdf.setFillColor(248, 250, 252);
        pdf.setDrawColor(226, 232, 240);
        pdf.roundedRect(margin, yPos, boxWidth, boxHeight, 2, 2, 'FD');
        pdf.setFontSize(8);
        pdf.setTextColor(100, 116, 139);
        pdf.setFont('helvetica', 'normal');
        pdf.text('LIEFERANT', margin + 3, yPos + 5);
        pdf.setFontSize(10);
        pdf.setTextColor(30, 41, 59);
        pdf.setFont('helvetica', 'bold');
        pdf.text(currentPdfBewertung.lieferant, margin + 3, yPos + 12, { maxWidth: boxWidth - 6 });

        // SE-Team box
        const box2X = margin + boxWidth + boxGap;
        pdf.setFillColor(248, 250, 252);
        pdf.roundedRect(box2X, yPos, boxWidth, boxHeight, 2, 2, 'FD');
        pdf.setFontSize(8);
        pdf.setTextColor(100, 116, 139);
        pdf.setFont('helvetica', 'normal');
        pdf.text('SE-TEAM', box2X + 3, yPos + 5);
        pdf.setFontSize(10);
        pdf.setTextColor(30, 41, 59);
        pdf.setFont('helvetica', 'bold');
        pdf.text(currentPdfBewertung.se_team || '-', box2X + 3, yPos + 12, { maxWidth: boxWidth - 6 });

        // Bestellnummer box - check if multi-line needed
        const bestellnummerText = currentPdfBewertung.bestellnummer || '-';
        const bestellnummerIsLong = bestellnummerText.length > 25 || bestellnummerText.includes('\n') || bestellnummerText.includes(',');

        const box3X = margin + 2 * (boxWidth + boxGap);
        pdf.setFillColor(248, 250, 252);
        pdf.roundedRect(box3X, yPos, boxWidth, boxHeight, 2, 2, 'FD');
        pdf.setFontSize(8);
        pdf.setTextColor(100, 116, 139);
        pdf.setFont('helvetica', 'normal');
        pdf.text('BESTELLNUMMER', box3X + 3, yPos + 5);
        pdf.setFontSize(10);
        pdf.setTextColor(30, 41, 59);
        pdf.setFont('helvetica', 'bold');
        // Show short preview or "siehe unten" for long bestellnummern
        if (bestellnummerIsLong) {
            pdf.setFontSize(8);
            pdf.setTextColor(100, 116, 139);
            pdf.setFont('helvetica', 'italic');
            pdf.text('(siehe unten)', box3X + 3, yPos + 12);
        } else {
            pdf.text(bestellnummerText, box3X + 3, yPos + 12, { maxWidth: boxWidth - 6 });
        }

        // Result box
        const box4X = margin + 3 * (boxWidth + boxGap);
        const ergebnis = currentPdfBewertung.ergebnis;
        let resultBgColor, resultTextColor;
        if (ergebnis >= state.settings.threshold_success) {
            resultBgColor = [220, 252, 231]; resultTextColor = [22, 163, 74];
        } else if (ergebnis >= state.settings.threshold_warning) {
            resultBgColor = [254, 243, 199]; resultTextColor = [217, 119, 6];
        } else {
            resultBgColor = [254, 226, 226]; resultTextColor = [220, 38, 38];
        }
        pdf.setFillColor(...resultBgColor);
        pdf.setDrawColor(...resultBgColor.map(c => Math.max(0, c - 30)));
        pdf.roundedRect(box4X, yPos, boxWidth, boxHeight, 2, 2, 'FD');
        pdf.setFontSize(8);
        pdf.setTextColor(100, 116, 139);
        pdf.setFont('helvetica', 'normal');
        pdf.text('ERGEBNIS', box4X + 3, yPos + 5);
        pdf.setFontSize(14);
        pdf.setTextColor(...resultTextColor);
        pdf.setFont('helvetica', 'bold');
        pdf.text(ergebnis.toFixed(1) + '%', box4X + 3, yPos + 13);

        yPos += boxHeight + 12;

        // ===== BESTELLNUMMER DETAIL SECTION (if long) =====
        if (bestellnummerIsLong && bestellnummerText !== '-') {
            checkNewPage(20);
            pdf.setFillColor(248, 250, 252);
            pdf.setDrawColor(217, 119, 6);
            pdf.setLineWidth(0.5);

            // Split bestellnummer text into lines
            const bestellnummerLines = pdf.splitTextToSize(bestellnummerText.replace(/,\s*/g, ', '), contentWidth - 12);
            const bestellnummerBoxHeight = 8 + bestellnummerLines.length * 4;

            pdf.roundedRect(margin, yPos, contentWidth, bestellnummerBoxHeight, 2, 2, 'FD');
            pdf.line(margin, yPos, margin, yPos + bestellnummerBoxHeight); // Left accent line

            pdf.setFontSize(8);
            pdf.setTextColor(100, 116, 139);
            pdf.setFont('helvetica', 'bold');
            pdf.text('BESTELLNUMMERN', margin + 4, yPos + 4);

            pdf.setFontSize(9);
            pdf.setTextColor(30, 41, 59);
            pdf.setFont('helvetica', 'normal');
            pdf.text(bestellnummerLines, margin + 4, yPos + 9);

            yPos += bestellnummerBoxHeight + 8;
        }

        // ===== CHART SECTION =====
        checkNewPage(60);
        pdf.setFontSize(12);
        pdf.setTextColor(30, 41, 59);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Bewertungsübersicht nach Kategorien', margin, yPos);
        yPos += 14;

        // Calculate group results - support both old array and new object format
        const groups = {};
        state.fragen.forEach(f => {
            if (!groups[f.gruppe]) groups[f.gruppe] = { total: 0, score: 0, count: 0 };
        });
        state.fragen.forEach(f => {
            const answer = Array.isArray(currentPdfBewertung.antworten)
                ? currentPdfBewertung.antworten[f.index]
                : currentPdfBewertung.antworten[f.id];
            
            const weight = f.gewichtung || 1;

            if (answer !== undefined && answer !== -1) {
                groups[f.gruppe].count++;
                groups[f.gruppe].total += 100 * weight;
                if (answer === 2) groups[f.gruppe].score += 100 * weight;
                else if (answer === 1) groups[f.gruppe].score += 50 * weight;
            }
        });

        const groupNames = Object.keys(groups);
        const groupResults = groupNames.map(name => {
            const g = groups[name];
            return g.total > 0 ? (g.score / g.total) * 100 : 0;
        });

        // Draw bar chart
        // Amber palette for PDF chart bars
        const chartColors = [
            [245, 158, 11], [217, 119, 6], [180, 83, 9],
            [146, 64, 14], [120, 53, 15], [251, 191, 36]
        ];
        const barWidth = Math.min(40, (contentWidth - 20) / groupNames.length - 10);
        const maxBarHeight = 35;
        const chartStartX = margin + 10;

        groupNames.forEach((name, i) => {
            const x = chartStartX + i * (barWidth + 15);
            const barHeight = (groupResults[i] / 100) * maxBarHeight;

            // Background bar
            pdf.setFillColor(226, 232, 240);
            pdf.roundedRect(x, yPos, barWidth, maxBarHeight, 1, 1, 'F');

            // Value bar
            pdf.setFillColor(...chartColors[i % chartColors.length]);
            if (barHeight > 0) {
                pdf.roundedRect(x, yPos + maxBarHeight - barHeight, barWidth, barHeight, 1, 1, 'F');
            }

            // Percentage above bar
            pdf.setFontSize(10);
            pdf.setTextColor(30, 41, 59);
            pdf.setFont('helvetica', 'bold');
            pdf.text(groupResults[i].toFixed(1) + '%', x + barWidth / 2, yPos - 2, { align: 'center' });
        });

        yPos += maxBarHeight + 8;

        // ===== DETAILS SECTION =====
        yPos += 5;
        checkNewPage(20);
        pdf.setFontSize(12);
        pdf.setTextColor(30, 41, 59);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Detailbewertung', margin, yPos);
        yPos += 8;

        // Group details - build groups object first
        const detailGroups = state.fragen.reduce((acc, f) => {
            if (!acc[f.gruppe]) acc[f.gruppe] = [];
            acc[f.gruppe].push(f);
            return acc;
        }, {});

        // Iterate through groupNames to maintain consistent order with chart
        groupNames.forEach((groupName, groupIndex) => {
            const fragen = detailGroups[groupName];
            if (!fragen) return;

            // Estimate actual height needed for this group (including multi-line questions)
            let estimatedGroupHeight = 15; // header + spacing
            fragen.forEach(f => {
                pdf.setFontSize(8);
                pdf.setFont('helvetica', 'normal');
                const estLines = pdf.splitTextToSize(f.text, contentWidth - 24);
                estimatedGroupHeight += Math.max(6, estLines.length * 3.5 + 2);
            });
            checkNewPage(estimatedGroupHeight);

            // Calculate group score - support both old array and new object format
            let groupScore = 0, groupTotal = 0;
            fragen.forEach(f => {
                const answer = Array.isArray(currentPdfBewertung.antworten)
                    ? currentPdfBewertung.antworten[f.index]
                    : currentPdfBewertung.antworten[f.id];
                
                const weight = f.gewichtung || 1;

                if (answer !== undefined && answer !== -1) {
                    groupTotal += 100 * weight;
                    if (answer === 2) groupScore += 100 * weight;
                    else if (answer === 1) groupScore += 50 * weight;
                }
            });
            const groupPercent = groupTotal > 0 ? (groupScore / groupTotal) * 100 : 0;

            // Group header - use same color as bar chart
            pdf.setFillColor(...chartColors[groupIndex % chartColors.length]);
            pdf.roundedRect(margin, yPos, contentWidth, 8, 1, 1, 'F');
            pdf.setFontSize(10);
            pdf.setTextColor(255);
            pdf.setFont('helvetica', 'bold');
            pdf.text(groupName, margin + 4, yPos + 5.5);
            pdf.text(groupPercent.toFixed(1) + '%', pageWidth - margin - 4, yPos + 5.5, { align: 'right' });
            yPos += 10;

            // Questions
            fragen.forEach((f, idx) => {
                // Support both old array format and new object format
                const answer = Array.isArray(currentPdfBewertung.antworten)
                    ? currentPdfBewertung.antworten[f.index]
                    : currentPdfBewertung.antworten[f.id];
                let answerText, answerColor;

                if (answer === 2) {
                    answerText = 'Erfüllt'; answerColor = [22, 163, 74];
                } else if (answer === 1) {
                    answerText = 'Teilweise'; answerColor = [217, 119, 6];
                } else if (answer === 0) {
                    answerText = 'Nicht erfüllt'; answerColor = [220, 38, 38];
                } else {
                    answerText = 'Keine Angabe'; answerColor = [148, 163, 184];
                }

                // Calculate text height for multi-line support
                pdf.setFontSize(8);
                pdf.setFont('helvetica', 'normal');
                const statusWidth = 20;
                const maxTextWidth = contentWidth - statusWidth - 4;
                const textLines = pdf.splitTextToSize(f.text, maxTextWidth);
                const rowHeight = Math.max(6, textLines.length * 3.5 + 2);

                checkNewPage(rowHeight);

                // Alternating row background
                if (idx % 2 === 0) {
                    pdf.setFillColor(248, 250, 252);
                    pdf.rect(margin, yPos - 1, contentWidth, rowHeight, 'F');
                }

                // Question text - left aligned
                pdf.setTextColor(71, 85, 105);
                pdf.text(textLines, margin + 3, yPos + 3);

                // Status text - right aligned with reduced spacing
                pdf.setTextColor(...answerColor);
                pdf.setFont('helvetica', 'bold');
                pdf.text(answerText, pageWidth - margin - 3, yPos + 3, { align: 'right' });

                yPos += rowHeight;
            });

            yPos += 5;
        });

        // ===== COMMENTS SECTION =====
        const rawKommentare = currentPdfBewertung.kommentare || {};

        let commentEntries = [];
        for (const groupName of groupNames) {
            const kommentar = rawKommentare[groupName];
            if (kommentar && kommentar.trim()) {
                commentEntries.push({
                    label: groupName,
                    text: kommentar
                });
            }
        }

        if (commentEntries.length > 0) {
            checkNewPage(25);
            yPos += 5;
            pdf.setFontSize(12);
            pdf.setTextColor(30, 41, 59);
            pdf.setFont('helvetica', 'bold');
            pdf.text('Bemerkungen', margin, yPos);
            yPos += 8;

            commentEntries.forEach(entry => {
                checkNewPage(15);

                // Comment box
                pdf.setFillColor(248, 250, 252);
                pdf.setDrawColor(217, 119, 6);
                pdf.setLineWidth(0.5);

                // Set font to match rendering size BEFORE calculating line breaks
                pdf.setFontSize(9);
                pdf.setFont('helvetica', 'normal');
                const lines = pdf.splitTextToSize(entry.text, contentWidth - 12);
                const boxHeight = 8 + lines.length * 4;

                pdf.roundedRect(margin, yPos, contentWidth, boxHeight, 2, 2, 'FD');
                pdf.line(margin, yPos, margin, yPos + boxHeight); // Left accent line

                pdf.setFontSize(8);
                pdf.setTextColor(100, 116, 139);
                pdf.setFont('helvetica', 'bold');
                pdf.text(entry.label.toUpperCase(), margin + 4, yPos + 4);

                pdf.setFontSize(9);
                pdf.setTextColor(30, 41, 59);
                pdf.setFont('helvetica', 'normal');
                pdf.text(lines, margin + 4, yPos + 9);

                yPos += boxHeight + 4;
            });
        }

        // ===== MASSNAHMEN SECTION =====
        const massnahmenText = currentPdfBewertung.massnahmen || '';
        const massnahmenMeta = deriveMassnahmenMetadata(massnahmenText);
        if (massnahmenText.trim()) {
            checkNewPage(25);
            yPos += 5;
            pdf.setFontSize(12);
            pdf.setTextColor(30, 41, 59);
            pdf.setFont('helvetica', 'bold');
            pdf.text(massnahmenMeta.title, margin, yPos);
            yPos += 8;

            checkNewPage(15);

            // Maßnahmen box with orange/warning styling
            pdf.setFillColor(...massnahmenMeta.colors.fill);
            pdf.setDrawColor(...massnahmenMeta.colors.stroke);
            pdf.setLineWidth(0.5);

            const massnahmenLines = pdf.splitTextToSize(massnahmenText, contentWidth - 12);
            const massnahmenBoxHeight = 8 + massnahmenLines.length * 4;

            pdf.roundedRect(margin, yPos, contentWidth, massnahmenBoxHeight, 2, 2, 'FD');
            pdf.line(margin, yPos, margin, yPos + massnahmenBoxHeight); // Left accent line

            pdf.setFontSize(8);
            pdf.setTextColor(...massnahmenMeta.colors.label);
            pdf.setFont('helvetica', 'bold');
            pdf.text(massnahmenMeta.badgeLabel, margin + 4, yPos + 4);

            pdf.setFontSize(9);
            pdf.setTextColor(30, 41, 59);
            pdf.setFont('helvetica', 'normal');
            pdf.text(massnahmenLines, margin + 4, yPos + 9);

            yPos += massnahmenBoxHeight + 4;
        }

        // ===== SIGNATURE SECTION =====
        checkNewPage(45);
        yPos += 10;
        pdf.setFontSize(12);
        pdf.setTextColor(30, 41, 59);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Unterschriften', margin, yPos);
        yPos += 20;

        const sigWidth = (contentWidth - 20) / 2;

        // Signature line 1
        pdf.setDrawColor(30, 41, 59);
        pdf.setLineWidth(0.3);
        pdf.line(margin, yPos, margin + sigWidth, yPos);
        pdf.setFontSize(9);
        pdf.setTextColor(100, 116, 139);
        pdf.setFont('helvetica', 'normal');
        pdf.text('Datum, Unterschrift Bewerter', margin, yPos + 5);

        // Signature line 2
        pdf.line(margin + sigWidth + 20, yPos, pageWidth - margin, yPos);
        pdf.text('Datum, Unterschrift Lieferant', margin + sigWidth + 20, yPos + 5);

        // ===== FOOTER =====
        // Add page number to last page
        addPageNumber(pdf, pageNum, pageWidth, pageHeight);

        // Footer text
        pdf.setFontSize(8);
        pdf.setTextColor(148, 163, 184);
        const now = new Date();
        pdf.text('Erstellt mit SEVALSystem - Supplier Evaluation System', margin, pageHeight - 12);
        pdf.text(`Erstellt am ${formatDateDisplay(now)}`, pageWidth - margin, pageHeight - 12, { align: 'right' });

        // Get PDF as base64 and save via Tauri with dialog
        const pdfBase64 = pdf.output('datauristring').split(',')[1];

        // Use combined Rust command that shows dialog and saves
        const savedPath = await invoke('save_pdf_with_dialog', {
            defaultFilename: defaultFilename,
            base64Data: pdfBase64
        });

        if (savedPath) {
            showStatus('PDF erfolgreich gespeichert: ' + savedPath, false);
            hideModal('pdfModal');
        } else {
            showToast('PDF-Export abgebrochen', 'warning');
        }
    } catch (e) {
        showStatus('Fehler beim Erstellen des PDFs: ' + e, true);
        console.error('PDF generation error:', e);
    }
}

// ============================================================================
// Batch-PDF Quartalsbericht (Phase 4.2)
// ============================================================================

async function generateBatchPdf() {
    const historie = state.historieData;
    if (!historie || historie.length === 0) {
        showToast('Keine Daten für den Quartalsbericht vorhanden', 'warning');
        return;
    }

    const btn = document.getElementById('batchPdfBtn');
    if (btn) {
        btn.disabled = true;
        btn.querySelector('.btn-text').textContent = 'Erstelle...';
    }

    try {
        const now = new Date();

        // Use the already-filtered historieData directly (respects Historie filters)
        let data = [...historie];

        // Build quarter label from active filters
        const jahrFilter = elements.historieJahrFilter.value || null;
        const quartalFilter = elements.historieQuartalFilter.value || null;
        let quarterLabel;
        if (quartalFilter && jahrFilter) {
            quarterLabel = `Q${quartalFilter} ${jahrFilter}`;
        } else if (quartalFilter) {
            quarterLabel = `Q${quartalFilter}`;
        } else if (jahrFilter) {
            quarterLabel = `${jahrFilter}`;
        } else {
            quarterLabel = 'Alle Quartale';
        }

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 15;
        const contentWidth = pageWidth - 2 * margin;
        let pageNum = 0;

        const addFooter = () => {
            pageNum++;
            pdf.setFontSize(8);
            pdf.setTextColor(150);
            pdf.text(`Seite ${pageNum}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
            pdf.text('Erstellt mit SEVALSystem', margin, pageHeight - 8);
            pdf.text(formatDateDisplay(now), pageWidth - margin, pageHeight - 8, { align: 'right' });
        };

        // ===== DECKBLATT =====
        let y = 60;

        if (state.pdfLogoBase64) {
            // Logo aspect ratio 935:279 ≈ 3.35:1
            const logoH = 12;
            const logoW = logoH * 3.35;
            pdf.addImage(state.pdfLogoBase64, 'PNG', margin, 20, logoW, logoH);
        }

        pdf.setFontSize(28);
        pdf.setTextColor(30, 41, 59);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Quartalsbericht', margin, y);

        y += 12;
        pdf.setFontSize(18);
        pdf.setTextColor(217, 119, 6);
        pdf.text(quarterLabel, margin, y);

        y += 12;
        pdf.setDrawColor(217, 119, 6);
        pdf.setLineWidth(0.8);
        pdf.line(margin, y, pageWidth - margin, y);

        y += 16;
        pdf.setFontSize(11);
        pdf.setTextColor(100, 116, 139);
        pdf.setFont('helvetica', 'normal');

        const avg = data.reduce((s, h) => s + h.ergebnis, 0) / data.length;
        const bestE = data.reduce((m, h) => h.ergebnis > m.ergebnis ? h : m, data[0]);
        const worstE = data.reduce((m, h) => h.ergebnis < m.ergebnis ? h : m, data[0]);
        const uniqueL = [...new Set(data.map(h => h.lieferant))];

        const summaryItems = [
            `Bewertungen: ${data.length}`,
            `Lieferanten: ${uniqueL.length}`,
            `Durchschnitt: ${avg.toFixed(1)}%`,
            `Bester Wert: ${bestE.ergebnis.toFixed(1)}% (${bestE.lieferant})`,
            `Schlechtester: ${worstE.ergebnis.toFixed(1)}% (${worstE.lieferant})`,
        ];
        summaryItems.forEach(item => {
            pdf.text(item, margin, y);
            y += 7;
        });

        addFooter();

        // ===== ÜBERSICHTSTABELLE =====
        pdf.addPage();
        y = margin;

        pdf.setFontSize(14);
        pdf.setTextColor(30, 41, 59);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Übersicht aller Bewertungen', margin, y + 5);
        y += 14;

        // Table header
        const cols = [
            { label: '#', x: margin, w: 10 },
            { label: 'Lieferant', x: margin + 10, w: 55 },
            { label: 'SE-Team', x: margin + 65, w: 35 },
            { label: 'Datum', x: margin + 100, w: 25 },
            { label: 'Ergebnis', x: margin + 125, w: 25 },
            { label: 'Bewertung', x: margin + 150, w: 30 },
        ];

        const drawTableHeader = () => {
            pdf.setFillColor(248, 250, 252);
            pdf.rect(margin, y, contentWidth, 8, 'F');
            pdf.setFontSize(8);
            pdf.setTextColor(100, 116, 139);
            pdf.setFont('helvetica', 'bold');
            cols.forEach(c => { pdf.text(c.label, c.x + 2, y + 5.5); });
            y += 10;
        };

        drawTableHeader();

        // Sort by result descending
        const sorted = [...data].sort((a, b) => b.ergebnis - a.ergebnis);

        sorted.forEach((h, idx) => {
            if (y > pageHeight - 25) {
                addFooter();
                pdf.addPage();
                y = margin;
                drawTableHeader();
            }

            // Alternating row background
            if (idx % 2 === 0) {
                pdf.setFillColor(252, 252, 253);
                pdf.rect(margin, y - 1, contentWidth, 7, 'F');
            }

            pdf.setFontSize(8);
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(30, 41, 59);

            const truncate = (s, max) => s && s.length > max ? s.substring(0, max) + '...' : (s || '');

            pdf.text(String(idx + 1), cols[0].x + 2, y + 4);
            pdf.text(truncate(h.lieferant, 30), cols[1].x + 2, y + 4);
            pdf.text(truncate(h.se_team, 18), cols[2].x + 2, y + 4);
            pdf.text(formatDate(h.datum), cols[3].x + 2, y + 4);

            // Color-coded result
            if (h.ergebnis >= state.settings.threshold_success) {
                pdf.setTextColor(22, 163, 74);
            } else if (h.ergebnis >= state.settings.threshold_warning) {
                pdf.setTextColor(217, 119, 6);
            } else {
                pdf.setTextColor(220, 38, 38);
            }
            pdf.setFont('helvetica', 'bold');
            pdf.text(h.ergebnis.toFixed(1) + '%', cols[4].x + 2, y + 4);

            // Status bar
            const barX = cols[5].x + 2;
            const barW = 25;
            const barH = 4;
            const barY = y + 1.5;
            pdf.setFillColor(226, 232, 240);
            pdf.roundedRect(barX, barY, barW, barH, 1, 1, 'F');
            const fillW = (h.ergebnis / 100) * barW;
            if (h.ergebnis >= state.settings.threshold_success) pdf.setFillColor(34, 197, 94);
            else if (h.ergebnis >= state.settings.threshold_warning) pdf.setFillColor(245, 158, 11);
            else pdf.setFillColor(239, 68, 68);
            pdf.roundedRect(barX, barY, fillW, barH, 1, 1, 'F');

            y += 7;
        });

        // ===== LIEFERANTEN-DETAILS (fortlaufend nach Übersicht) =====
        // Group by lieferant
        const byLieferant = {};
        sorted.forEach(h => {
            if (!byLieferant[h.lieferant]) byLieferant[h.lieferant] = [];
            byLieferant[h.lieferant].push(h);
        });

        const lieferantKeys = Object.keys(byLieferant).sort((a, b) => a.localeCompare(b, 'de'));

        lieferantKeys.forEach((lieferant, lieferantIdx) => {
            const entries = byLieferant[lieferant];

            // Check if enough space for header + at least 2 rows (~40mm)
            if (y > pageHeight - 45) {
                addFooter();
                pdf.addPage();
                y = margin;
            }

            // Amber divider
            y += 6;
            pdf.setDrawColor(217, 119, 6);
            pdf.setLineWidth(0.8);
            pdf.line(margin, y, pageWidth - margin, y);
            y += 8;

            // Lieferant header with amber accent bar
            pdf.setFillColor(255, 251, 235);
            pdf.rect(margin, y - 4, contentWidth, 12, 'F');
            pdf.setFillColor(217, 119, 6);
            pdf.rect(margin, y - 4, 3, 12, 'F');

            pdf.setFontSize(13);
            pdf.setTextColor(30, 41, 59);
            pdf.setFont('helvetica', 'bold');
            pdf.text(lieferant, margin + 7, y + 3);

            // Count indicator (dezent, rechts)
            const countText = `(${entries.length} Bewertung${entries.length > 1 ? 'en' : ''})`;
            pdf.setFontSize(9);
            pdf.setTextColor(180, 160, 120);
            pdf.setFont('helvetica', 'normal');
            pdf.text(countText, pageWidth - margin, y + 3, { align: 'right' });

            y += 12;

            // Summary line for this supplier
            const lAvg = entries.reduce((s, h) => s + h.ergebnis, 0) / entries.length;
            const lBest = Math.max(...entries.map(h => h.ergebnis));
            const lWorst = Math.min(...entries.map(h => h.ergebnis));

            // Color-coded average indicator
            let avgColor;
            if (lAvg >= state.settings.threshold_success) avgColor = [22, 163, 74];
            else if (lAvg >= state.settings.threshold_warning) avgColor = [217, 119, 6];
            else avgColor = [220, 38, 38];

            // Color helper for threshold-based coloring
            const scoreColor = (val) => {
                if (val >= state.settings.threshold_success) return [22, 163, 74];
                if (val >= state.settings.threshold_warning) return [180, 130, 20];
                return [220, 38, 38];
            };

            pdf.setFontSize(9);
            let cx = margin + 7;

            // Durchschnitt label + value
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(100, 116, 139);
            pdf.text('\u00D8 ', cx, y);
            cx += pdf.getTextWidth('\u00D8 ');
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(...avgColor);
            pdf.text(`${lAvg.toFixed(1)}%`, cx, y);
            cx += pdf.getTextWidth(`${lAvg.toFixed(1)}%`);

            // Separator
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(180, 180, 180);
            pdf.text('   |   ', cx, y);
            cx += pdf.getTextWidth('   |   ');

            // Best label + value
            pdf.setTextColor(100, 116, 139);
            pdf.text('Best: ', cx, y);
            cx += pdf.getTextWidth('Best: ');
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(...scoreColor(lBest));
            pdf.text(`${lBest.toFixed(1)}%`, cx, y);
            cx += pdf.getTextWidth(`${lBest.toFixed(1)}%`);

            // Separator
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(180, 180, 180);
            pdf.text('   |   ', cx, y);
            cx += pdf.getTextWidth('   |   ');

            // Schlechtester label + value
            pdf.setTextColor(100, 116, 139);
            pdf.text('Min: ', cx, y);
            cx += pdf.getTextWidth('Min: ');
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(...scoreColor(lWorst));
            pdf.text(`${lWorst.toFixed(1)}%`, cx, y);

            y += 8;

            // Mini table header
            const lCols = [
                { label: 'Datum', x: margin + 4 },
                { label: 'SE-Team', x: margin + 30 },
                { label: 'Ergebnis', x: margin + 75 },
                { label: 'Trend', x: margin + 100 },
            ];
            pdf.setFillColor(241, 245, 249);
            pdf.rect(margin, y - 1, contentWidth, 7, 'F');
            pdf.setFontSize(7.5);
            pdf.setTextColor(100, 116, 139);
            pdf.setFont('helvetica', 'bold');
            lCols.forEach(c => pdf.text(c.label, c.x, y + 4));
            y += 8;

            // Entries
            entries.sort((a, b) => new Date(b.datum) - new Date(a.datum));
            entries.forEach((h, idx) => {
                if (y > pageHeight - 20) {
                    addFooter();
                    pdf.addPage();
                    y = margin;
                }

                if (idx % 2 === 0) {
                    pdf.setFillColor(252, 252, 253);
                    pdf.rect(margin, y - 1, contentWidth, 7, 'F');
                }

                pdf.setFontSize(9);
                pdf.setFont('helvetica', 'normal');
                pdf.setTextColor(30, 41, 59);
                pdf.text(formatDate(h.datum), lCols[0].x, y + 4);
                pdf.text(h.se_team || '\u2014', lCols[1].x, y + 4);

                if (h.ergebnis >= state.settings.threshold_success) pdf.setTextColor(22, 163, 74);
                else if (h.ergebnis >= state.settings.threshold_warning) pdf.setTextColor(217, 119, 6);
                else pdf.setTextColor(220, 38, 38);
                pdf.setFont('helvetica', 'bold');
                pdf.text(h.ergebnis.toFixed(1) + '%', lCols[2].x, y + 4);

                // Vorquartal delta
                if (h.vorquartal_diff !== null && h.vorquartal_diff !== undefined) {
                    const sign = h.vorquartal_diff >= 0 ? '+' : '';
                    pdf.setFontSize(8);
                    pdf.setTextColor(h.vorquartal_diff >= 0 ? 22 : 220, h.vorquartal_diff >= 0 ? 163 : 38, h.vorquartal_diff >= 0 ? 74 : 38);
                    pdf.text(`${sign}${h.vorquartal_diff.toFixed(1)}%`, lCols[3].x, y + 4);
                } else {
                    pdf.setFontSize(8);
                    pdf.setTextColor(180, 180, 180);
                    pdf.text('\u2014', lCols[3].x, y + 4);
                }

                y += 7;
            });

            y += 2;
        });

        addFooter();

        // Save
        const filename = `SEVALSystem_Quartalsbericht_${quarterLabel.replace(' ', '_')}.pdf`;
        const pdfBase64 = pdf.output('datauristring').split(',')[1];
        const savedPath = await invoke('save_pdf_with_dialog', {
            defaultFilename: filename,
            base64Data: pdfBase64
        });

        if (savedPath) {
            showToast('Quartalsbericht gespeichert: ' + savedPath, 'success');
        } else {
            showToast('PDF-Export abgebrochen', 'warning');
        }
    } catch (e) {
        console.error('Batch PDF error:', e);
        showToast('Fehler beim Erstellen des Quartalsberichts: ' + e, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.querySelector('.btn-text').textContent = 'Quartalsbericht';
        }
    }
}

// ============================================================================
// Export Functions (Trends View)
// ============================================================================

// Export Charts as PNG using html2canvas
async function exportChartsToPng() {
    const btn = document.getElementById('exportChartsPng');
    if (!btn) return;

    try {
        // Add exporting state
        btn.classList.add('exporting');
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
            </svg>
            Exportiere...
        `;

        // Get the charts container
        const chartsContainer = document.querySelector('.trends-charts');
        if (!chartsContainer) {
            throw new Error('Charts-Container nicht gefunden');
        }

        // Wait for charts to be fully rendered
        await new Promise(resolve => setTimeout(resolve, 100));

        // Use html2canvas to capture the charts
        const canvas = await html2canvas(chartsContainer, {
            backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim() || '#ffffff',
            scale: 2, // Higher resolution
            logging: false,
            useCORS: true
        });

        // Create filename with date
        const now = new Date();
        const dateStr = formatDateISO(now);
        const filename = `SEVALSystem_Trends_${dateStr}.png`;

        // Convert to blob and download
        canvas.toBlob(async (blob) => {
            if (!blob) {
                throw new Error('PNG-Erstellung fehlgeschlagen');
            }

            // Try to use Tauri's save dialog if available
            try {
                const base64 = await blobToBase64(blob);
                const savedPath = await invoke('save_image_with_dialog', {
                    defaultFilename: filename,
                    base64Data: base64.split(',')[1]
                });

                if (savedPath) {
                    showStatus('Charts erfolgreich als PNG gespeichert: ' + savedPath, false);
                } else {
                    showToast('PNG-Export abgebrochen', 'warning');
                }
            } catch (tauriError) {
                console.error('Tauri save dialog error:', tauriError);
                showStatus('Fehler beim Speichern: ' + tauriError, true);
            }
        }, 'image/png');

    } catch (e) {
        console.error('PNG Export Error:', e);
        showStatus('Fehler beim PNG-Export: ' + e.message, true);
    } finally {
        // Reset button
        btn.classList.remove('exporting');
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21,15 16,10 5,21"/>
            </svg>
            Charts als PNG
        `;
    }
}

// Helper: Convert Blob to Base64
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Export Data as CSV
async function exportDataToCsv() {
    const btn = document.getElementById('exportDataCsv');
    if (!btn) return;

    try {
        // Add exporting state
        btn.classList.add('exporting');
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
            </svg>
            Exportiere...
        `;

        const historie = state.historieData;
        if (!historie || historie.length === 0) {
            throw new Error('Keine Daten zum Exportieren vorhanden');
        }

        // Build CSV with BOM for Excel compatibility
        const BOM = '\uFEFF';
        const separator = ';'; // Use semicolon for German Excel

        // Header row
        const headers = [
            'Datum',
            'Lieferant',
            'SE-Team',
            'Bestellnummer',
            'Ergebnis (%)',
            'Offene Maßnahmen',
            'Vorquartal (%)',
            'Delta Vorquartal (%)'
        ];
        let csv = BOM + headers.join(separator) + '\n';

        // Data rows (sorted by date)
        const sorted = [...historie].sort((a, b) => new Date(b.datum) - new Date(a.datum));
        sorted.forEach(h => {
            const row = [
                formatDate(h.datum),
                escapeCSV(h.lieferant),
                escapeCSV(h.se_team || '-'),
                escapeCSV(h.bestellnummer || ''),
                h.ergebnis.toFixed(1).replace('.', ','),
                h.has_open_massnahmen ? 'JA' : 'NEIN',
                h.vorquartal_ergebnis !== null && h.vorquartal_ergebnis !== undefined
                    ? h.vorquartal_ergebnis.toFixed(1).replace('.', ',')
                    : '',
                h.vorquartal_diff !== null && h.vorquartal_diff !== undefined
                    ? h.vorquartal_diff.toFixed(1).replace('.', ',')
                    : ''
            ];
            csv += row.join(separator) + '\n';
        });

        // Add summary section
        csv += '\n' + new Array(headers.length).fill('').join(separator) + '\n';
        csv += 'Zusammenfassung' + separator + new Array(headers.length - 1).fill('').join(separator) + '\n';

        const total = sorted.length;
        const avg = sorted.reduce((sum, h) => sum + h.ergebnis, 0) / total;
        const best = Math.max(...sorted.map(h => h.ergebnis));
        const worst = Math.min(...sorted.map(h => h.ergebnis));

        const fillCols = new Array(headers.length - 2).fill('');
        csv += `Anzahl Bewertungen${separator}${total}${separator}${fillCols.join(separator)}\n`;
        csv += `Durchschnitt${separator}${avg.toFixed(1).replace('.', ',')}%${separator}${fillCols.join(separator)}\n`;
        csv += `Bester Wert${separator}${best.toFixed(1).replace('.', ',')}%${separator}${fillCols.join(separator)}\n`;
        csv += `Schlechtester Wert${separator}${worst.toFixed(1).replace('.', ',')}%${separator}${fillCols.join(separator)}\n`;

        // Create filename with date
        const now = new Date();
        const dateStr = formatDateISO(now);
        const filename = `SEVALSystem_Bewertungen_${dateStr}.csv`;

        // Create Blob
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });

        // Try to use Tauri's save dialog if available
        try {
            const base64 = await blobToBase64(blob);
            const savedPath = await invoke('save_csv_with_dialog', {
                defaultFilename: filename,
                base64Data: base64.split(',')[1]
            });

            if (savedPath) {
                showStatus('Daten erfolgreich als CSV gespeichert: ' + savedPath, false);
            } else {
                showToast('CSV-Export abgebrochen', 'warning');
            }
        } catch (tauriError) {
            console.error('Tauri save dialog error:', tauriError);
            showStatus('Fehler beim Speichern: ' + tauriError, true);
        }

    } catch (e) {
        console.error('CSV Export Error:', e);
        showStatus('Fehler beim CSV-Export: ' + e.message, true);
    } finally {
        // Reset button
        btn.classList.remove('exporting');
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10,9 9,9 8,9"/>
            </svg>
            Daten als CSV
        `;
    }
}

// Helper: Escape CSV field
// ============================================================================
// XLSX Export (Phase 4.3)
// ============================================================================

async function exportDataToXlsx() {
    const btn = document.getElementById('exportDataXlsx');
    if (!btn) return;

    try {
        btn.classList.add('exporting');
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
            </svg>
            Exportiere...
        `;

        const now = new Date();
        const dateStr = formatDateISO(now);
        const filename = `SEVALSystem_Bewertungen_${dateStr}.xlsx`;

        const savedPath = await invoke('export_xlsx_with_dialog', {
            defaultFilename: filename,
        });

        if (savedPath) {
            showToast('Excel-Datei gespeichert: ' + savedPath, 'success');
        } else {
            showToast('XLSX-Export abgebrochen', 'warning');
        }
    } catch (e) {
        console.error('XLSX Export Error:', e);
        showToast('Fehler beim XLSX-Export: ' + e, 'error');
    } finally {
        btn.classList.remove('exporting');
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
                <line x1="8" y1="13" x2="16" y2="13"/>
                <line x1="8" y1="17" x2="16" y2="17"/>
            </svg>
            Excel (XLSX)
        `;
    }
}

// ============================================================================
// CSV Import (Phase 4.1)
// ============================================================================

let csvImportParsedData = [];

function setupCsvImport() {
    const openBtn = document.getElementById('csvImportOpenBtn');
    const closeBtn = document.getElementById('csvImportCloseBtn');
    const cancelBtn = document.getElementById('csvImportCancelBtn');
    const importBtn = document.getElementById('csvImportBtn');
    const dropzone = document.getElementById('csvDropzone');

    if (openBtn) {
        openBtn.addEventListener('click', () => {
            csvImportReset();
            showModal('csvImportModal');
        });
    }
    if (closeBtn) closeBtn.addEventListener('click', () => hideModal('csvImportModal'));
    if (cancelBtn) cancelBtn.addEventListener('click', () => hideModal('csvImportModal'));
    if (importBtn) importBtn.addEventListener('click', csvImportExecute);

    if (dropzone) {
        dropzone.addEventListener('click', csvImportOpenFile);
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });
        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('dragover');
        });
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && (file.name.endsWith('.csv') || file.name.endsWith('.txt'))) {
                const reader = new FileReader();
                reader.onload = (ev) => csvImportParseContent(ev.target.result);
                reader.readAsText(file, 'UTF-8');
            } else {
                showToast('Bitte eine CSV-Datei wählen', 'warning');
            }
        });
    }
}

function csvImportReset() {
    csvImportParsedData = [];
    document.getElementById('csvImportStep1').style.display = 'block';
    document.getElementById('csvImportStep2').style.display = 'none';
    document.getElementById('csvImportStep3').style.display = 'none';
    document.getElementById('csvImportBtn').style.display = 'none';
    document.getElementById('csvImportCancelBtn').textContent = 'Abbrechen';
}

async function csvImportOpenFile() {
    try {
        const content = await invoke('open_csv_with_dialog');
        if (content) {
            csvImportParseContent(content);
        }
    } catch (e) {
        showToast('Fehler beim Öffnen: ' + e, 'error');
    }
}

function csvImportParseContent(content) {
    // Remove BOM
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.substring(1);
    }

    // Auto-detect separator
    const firstLine = content.split('\n')[0];
    const separator = firstLine.includes(';') ? ';' : ',';

    // Parse CSV
    const lines = csvSplitLines(content);
    if (lines.length < 2) {
        showToast('CSV enthält keine Daten', 'warning');
        return;
    }

    const headers = csvParseLine(lines[0], separator).map(h => h.trim().toLowerCase());

    // Map columns
    const colMap = {
        datum: findColumn(headers, ['datum', 'date', 'bewertungsdatum']),
        lieferant: findColumn(headers, ['lieferant', 'supplier', 'lieferantenname']),
        se_team: findColumn(headers, ['se-team', 'se_team', 'seteam', 'team']),
        ergebnis: findColumn(headers, ['ergebnis', 'ergebnis (%)', 'result', 'score', 'bewertung']),
        bestellnummer: findColumn(headers, ['bestellnummer', 'bestellnr', 'order', 'po']),
        massnahmen: findColumn(headers, ['massnahmen', 'maßnahmen', 'actions', 'measures']),
    };

    if (colMap.datum === -1 || colMap.lieferant === -1 || colMap.ergebnis === -1) {
        showToast('CSV-Format nicht erkannt. Benötigt: Datum, Lieferant, Ergebnis', 'error');
        return;
    }

    // Parse data rows
    const parsed = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('Zusammenfassung') || line.startsWith('Anzahl')) continue;

        const cols = csvParseLine(line, separator);
        if (cols.length < 3) continue;

        const datum = parseDateFlexible(cols[colMap.datum]?.trim() || '');
        const lieferant = cols[colMap.lieferant]?.trim() || '';
        const ergebnisRaw = cols[colMap.ergebnis]?.trim() || '';
        const se_team = colMap.se_team !== -1 ? (cols[colMap.se_team]?.trim() || '') : '';
        const bestellnummer = colMap.bestellnummer !== -1 ? (cols[colMap.bestellnummer]?.trim() || '') : '';
        const massnahmen = colMap.massnahmen !== -1 ? (cols[colMap.massnahmen]?.trim() || '') : '';

        // Parse Ergebnis (handle German decimal separator)
        let ergebnis = parseFloat(ergebnisRaw.replace(',', '.').replace('%', ''));
        if (isNaN(ergebnis)) ergebnis = -1;

        let status = 'ok';
        let statusText = '';
        if (!datum) { status = 'error'; statusText = 'Datum ungültig'; }
        else if (!lieferant) { status = 'error'; statusText = 'Lieferant fehlt'; }
        else if (ergebnis < 0 || ergebnis > 100) { status = 'error'; statusText = 'Ergebnis ungültig'; }

        parsed.push({
            datum: datum || ergebnisRaw,
            lieferant,
            se_team,
            ergebnis,
            bestellnummer,
            massnahmen,
            status,
            statusText,
            rowNum: i + 1
        });
    }

    csvImportParsedData = parsed;
    csvImportShowPreview(parsed);
}

function findColumn(headers, alternatives) {
    for (const alt of alternatives) {
        const idx = headers.indexOf(alt);
        if (idx !== -1) return idx;
    }
    // Partial match
    for (const alt of alternatives) {
        const idx = headers.findIndex(h => h.includes(alt));
        if (idx !== -1) return idx;
    }
    return -1;
}

function parseDateFlexible(str) {
    if (!str) return null;
    // ISO format: 2026-01-15
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    // German format: 15.01.2026
    const match = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    // Try Date parsing
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    return null;
}

function csvSplitLines(content) {
    // Handle quoted fields with newlines
    const lines = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < content.length; i++) {
        const ch = content[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
            current += ch;
        } else if (ch === '\n' && !inQuotes) {
            if (current.trim()) lines.push(current.replace(/\r$/, ''));
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) lines.push(current.replace(/\r$/, ''));
    return lines;
}

function csvParseLine(line, sep) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === sep && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current);
    return result;
}

function csvImportShowPreview(data) {
    document.getElementById('csvImportStep1').style.display = 'none';
    document.getElementById('csvImportStep2').style.display = 'block';
    document.getElementById('csvImportBtn').style.display = 'inline-flex';

    const valid = data.filter(d => d.status === 'ok').length;
    const errors = data.filter(d => d.status === 'error').length;

    document.getElementById('csvPreviewInfo').innerHTML = `
        <span><strong>${data.length}</strong> Zeilen erkannt</span>
        <span><strong style="color:var(--success)">${valid}</strong> gültig</span>
        ${errors > 0 ? `<span><strong style="color:var(--danger)">${errors}</strong> fehlerhaft</span>` : ''}
    `;

    // Table header
    document.getElementById('csvPreviewHead').innerHTML = `
        <tr>
            <th>#</th>
            <th>Datum</th>
            <th>Lieferant</th>
            <th>SE-Team</th>
            <th>Ergebnis</th>
            <th>Bestellnr.</th>
            <th>Status</th>
        </tr>
    `;

    // Table body (max 100 rows for performance)
    const showData = data.slice(0, 100);
    document.getElementById('csvPreviewBody').innerHTML = showData.map(d => {
        const cls = d.status === 'error' ? 'csv-row-error' : '';
        const statusHtml = d.status === 'error'
            ? `<span class="csv-row-status" style="color:var(--danger)">${escapeHtml(d.statusText)}</span>`
            : '<span class="csv-row-status" style="color:var(--success)">OK</span>';
        return `<tr class="${cls}">
            <td>${d.rowNum}</td>
            <td>${escapeHtml(d.datum)}</td>
            <td>${escapeHtml(d.lieferant)}</td>
            <td>${escapeHtml(d.se_team || '—')}</td>
            <td>${d.ergebnis >= 0 ? d.ergebnis.toFixed(1) + '%' : '—'}</td>
            <td>${escapeHtml(d.bestellnummer || '—')}</td>
            <td>${statusHtml}</td>
        </tr>`;
    }).join('');

    if (data.length > 100) {
        document.getElementById('csvPreviewBody').innerHTML += `
            <tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);font-style:italic;">
                ... und ${data.length - 100} weitere Zeilen
            </td></tr>`;
    }
}

async function csvImportExecute() {
    const validData = csvImportParsedData.filter(d => d.status === 'ok');
    if (validData.length === 0) {
        showToast('Keine gültigen Daten zum Importieren', 'warning');
        return;
    }

    const skipDuplicates = document.getElementById('csvSkipDuplicates').checked;
    const importBtn = document.getElementById('csvImportBtn');
    importBtn.disabled = true;
    importBtn.innerHTML = `
        <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;margin-right:6px;animation:spin 1s linear infinite;">
            <circle cx="12" cy="12" r="10"/>
        </svg>
        Importiere...
    `;

    try {
        const bewertungen = validData.map(d => ({
            lieferant: d.lieferant,
            se_team: d.se_team,
            datum: d.datum,
            ergebnis: d.ergebnis,
            bestellnummer: d.bestellnummer,
            massnahmen: d.massnahmen,
        }));

        const result = await invoke('import_bewertungen_cmd', {
            bewertungen: bewertungen,
            skipDuplicates: skipDuplicates,
        });

        // Show result
        document.getElementById('csvImportStep2').style.display = 'none';
        document.getElementById('csvImportStep3').style.display = 'block';
        importBtn.style.display = 'none';
        document.getElementById('csvImportCancelBtn').textContent = 'Schließen';

        let resultHtml = '<div class="csv-result-summary">';
        resultHtml += `<div class="csv-result-item success">${result.imported} importiert</div>`;
        if (result.skipped_duplicate > 0) {
            resultHtml += `<div class="csv-result-item warning">${result.skipped_duplicate} Duplikate übersprungen</div>`;
        }
        if (result.errors.length > 0) {
            resultHtml += `<div class="csv-result-item error">${result.errors.length} Fehler</div>`;
        }
        resultHtml += '</div>';

        if (result.errors.length > 0) {
            resultHtml += '<div class="csv-result-errors">';
            result.errors.forEach(e => { resultHtml += `<div>${escapeHtml(e)}</div>`; });
            resultHtml += '</div>';
        }

        document.getElementById('csvImportResult').innerHTML = resultHtml;

        // Refresh data
        if (result.imported > 0) {
            showToast(`${result.imported} Bewertung${result.imported !== 1 ? 'en' : ''} importiert`, 'success');
            await loadHistorie();
            await loadDashboard();
        }
    } catch (e) {
        showToast('Import fehlgeschlagen: ' + e, 'error');
    } finally {
        importBtn.disabled = false;
        importBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;margin-right:6px;">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="17,8 12,3 7,8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Importieren
        `;
    }
}

function escapeCSV(str) {
    if (!str) return '';
    str = String(str);
    // If contains separator, quote, or newline, wrap in quotes
    if (str.includes(';') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// ============================================================================
// Start
// ============================================================================
document.addEventListener('DOMContentLoaded', init);

function initPasswordToggles() {
    document.querySelectorAll('.password-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            const input = document.getElementById(targetId);
            if (!input) return;

            const isPassword = input.getAttribute('type') === 'password';
            input.setAttribute('type', isPassword ? 'text' : 'password');
            btn.classList.toggle('visible', !isPassword);
        });
    });
}
function hasAdminAccess() {
    return !!(state.currentUser && state.currentUser.role === 'admin');
}
function canEditBewertung() {
    return hasAdminAccess() || !!(state.currentUser && state.currentUser.role === 'controlling');
}
function canSaveBewertung() {
    return hasAdminAccess() || !!(state.currentUser && state.currentUser.role === 'member');
}
function applyRoleVisibility(user) {
    resetRoleVisibility();

    if (!user) return;

    const role = (user.role || '').toLowerCase();
    const isAdmin = role === 'admin';

    if (isAdmin) {
        document.body.classList.add('role-admin');
        document.querySelectorAll('.admin-only-menu').forEach(el => {
            el.style.display = el.classList.contains('settings-card') ? 'block' : 'flex';
        });
        document.querySelectorAll('.admin-only-tab').forEach(el => el.style.display = 'flex');
        document.querySelectorAll('.admin-only-section').forEach(el => el.style.display = '');
        document.querySelectorAll('.member-only-section').forEach(el => el.style.display = '');
        document.querySelectorAll('.controlling-only-section').forEach(el => el.style.display = '');
        if (elements.auditLogBtn) elements.auditLogBtn.style.display = 'flex';
        return;
    }

    if (role === 'member') {
        document.body.classList.add('role-member');
        document.querySelectorAll('.member-only-section').forEach(el => el.style.display = '');
        // Member sieht eigene Audit-Log-Einträge
        document.querySelectorAll('.admin-only-tab[data-historie-view="audit"]').forEach(el => el.style.display = 'flex');
        if (elements.auditLogBtn) elements.auditLogBtn.style.display = 'flex';
    } else if (role === 'controlling') {
        document.body.classList.add('role-controlling');
        document.querySelectorAll('.controlling-only-section').forEach(el => el.style.display = '');
        document.querySelectorAll('.admin-only-tab[data-historie-view="audit"]').forEach(el => el.style.display = 'flex');
        const auditBtn = elements.auditLogBtn;
        if (auditBtn) auditBtn.style.display = 'flex';
    } else if (role === 'user') {
        document.body.classList.add('role-user');
    }
}

function resetRoleVisibility() {
    document.body.classList.remove('role-admin', 'role-member', 'role-controlling', 'role-user');
    document.querySelectorAll('.admin-only-menu').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.admin-only-tab').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.admin-only-section').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.member-only-section').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.controlling-only-section').forEach(el => el.style.display = 'none');
}
