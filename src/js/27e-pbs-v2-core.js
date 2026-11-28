/* PBS v2 - part 5a/7: app core (session state, shared-folder sync with conflict guard & write queue, cache, ChangeLog, owner suggestions).
 * Inert: only registers window.__ppPbsV2.core; no DOM access, timers or storage reads happen until the UI calls into it. */
(function ppPbsV2CorePart() {
  const P = (globalThis.__ppPbsV2 = globalThis.__ppPbsV2 || {});
  const IDB_NAME = 'pulseplan_pbs_handles_v1';
  const IDB_STORE = 'handles';
  const IDB_DIR_KEY = 'pbs_dir_handle';
  const PEOPLE_KEY = 'pulseplan_people_dir_v1';
  const POLL_MS = 15000;
  const SAVE_DEBOUNCE_MS = 650;
  const IO_TIMEOUT_MS = 10000;

  const S = {
    dirHandle: null, rememberedDirHandle: null,
    activeProjectId: '', activeDoc: null, activeFileModified: 0, activeWasEncrypted: false,
    lastWrittenId: '', saveTimer: null, pollTimer: null, isSaving: false, saveQueued: false,
    isFlushingForLock: false, dirtyProjectIds: new Set(),
    folderFileMtimes: new Map(), isBackgroundScanning: false, lastBackgroundPollAt: 0,
    conflictRemoteText: null, conflictRemoteDoc: null, conflictRemoteModified: 0,
    cache: null, syncStatusText: 'Saved locally in browser', syncStatusTone: 'idle',
    hooks: { rerender() {}, onBadges() {}, onStatus() {}, isDialogOpen() { return false; } },
  };

  const D = () => P.data;
  const supportsDirSync = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  const getSessionPassphrase = () => ((typeof ppSyncPassphrase === 'string' && ppSyncPassphrase) ? ppSyncPassphrase : '');
  const isSessionLocked = () => (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked());
  const encFormat = () => ((typeof PP_ENC_FORMAT === 'string' && PP_ENC_FORMAT) ? PP_ENC_FORMAT : 'pulseplan-encrypted-v1');

  function getDb() {
    if (typeof getActiveDB === 'function') return getActiveDB();
    if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
    return { departments: [], projects: [], milestones: [], changeLog: [] };
  }
  function getLiveDbRef() {
    if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
    return getDb();
  }
  const isDemoMode = () => Boolean(typeof ui !== 'undefined' && ui && ui.demoMode);
  const getUserName = () => ((typeof ui !== 'undefined' && ui && ui.userName) ? ui.userName : 'Project Mgr');
  const toast = (msg, type) => { if (typeof showToast === 'function') showToast(msg, type || 'info'); };
  const getProject = (id) => (getDb().projects || []).find(p => p.id === id) || null;

  function buildDemoPbsCache() {
    const now = new Date().toISOString();
    const mkDoc = (projectId, code, name, items) => {
      const raw = {
        schema: 'pulseplan-pbs-v1',
        projectId,
        projectCode: code,
        projectName: name,
        meta: { revision: 1, lastModifiedAt: now, lastModifiedBy: 'Demo', lastWriteId: '' },
        items: items.map((it) => ({
          id: it.id,
          parentId: it.parentId || null,
          code: it.code,
          name: it.name,
          deptId: it.deptId || 'd_eng',
          owner: it.owner || 'E. Rostova',
          maturity: it.maturity || 'CDR',
          milestoneId: it.milestoneId || '',
          notes: it.notes || '',
          acronym: it.acronym || '',
          description: it.description || '',
          heritage: it.heritage || 'New',
          mechDrawing: it.mechDrawing || '',
          elecDrawing: it.elecDrawing || '',
          refDoc: it.refDoc || '',
          manufacturer: it.manufacturer || '',
          partNumber: it.partNumber || '',
          procurementStatus: it.procurementStatus || '',
          qty: it.qty != null ? it.qty : 1,
          mass: it.mass != null ? it.mass : null,
          powerConsumption: it.powerConsumption != null ? it.powerConsumption : null,
          powerDissipation: it.powerDissipation != null ? it.powerDissipation : null,
          mtbf: it.mtbf != null ? it.mtbf : null,
          lru: it.lru || '',
          spareAvailable: it.spareAvailable || '',
          spareToDeliver: it.spareToDeliver || '',
          leadTime: it.leadTime != null ? it.leadTime : null,
          unitCost: it.unitCost != null ? it.unitCost : null,
          componentAlt: it.componentAlt || '',
        })),
      };
      return D().normalizePbsDoc(raw, { id: projectId, code, name }, 'Demo');
    };

    // 1. Project Nova (34 items, up to 5 nested levels, all fields populated)
    const novaItems = [
      { id: 'n_1', parentId: null, code: '1', name: 'Nova Core Platform System', deptId: 'd_eng', owner: 'E. Rostova', maturity: 'CDR', milestoneId: 'ms_1', acronym: 'NVA-SYS', description: 'Integrated multi-sensor autonomous platform with edge AI compute and thermal management', heritage: 'New', mechDrawing: 'DWG-NVA-0001-R3', elecDrawing: 'SCH-NVA-0001-R2', refDoc: 'ICD-NVA-SYS-001', manufacturer: 'Internal Assembly', partNumber: 'NVA-1000-01', procurementStatus: 'In Manufacture', lru: 'No', spareAvailable: 'No', spareToDeliver: 'No', notes: 'Top-level system baseline frozen for Beta cut' },

      // 1.1 Optical & Sensor Payload (4-5 levels deep)
      { id: 'n_1_1', parentId: 'n_1', code: '1.1', name: 'Optical & Sensor Payload', deptId: 'd_eng', owner: 'S. Chen', maturity: 'CDR', milestoneId: 'ms_1', acronym: 'OPT-PLD', description: 'Stabilized electro-optical, LWIR thermal, and 3D LiDAR sensing suite', heritage: 'Update', mechDrawing: 'DWG-NVA-1100-R4', elecDrawing: 'SCH-NVA-1100-R3', refDoc: 'SPEC-OPT-110', manufacturer: 'Internal Assembly', partNumber: 'NVA-1100-02', procurementStatus: 'In Manufacture', lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'Yes', notes: 'Primary cost & mass Pareto driver' },
      { id: 'n_1_1_1', parentId: 'n_1_1', code: '1.1.1', name: 'Cooled LWIR Thermal Camera Assembly', deptId: 'd_eng', owner: 'S. Chen', maturity: 'CDR', milestoneId: 'ms_1', acronym: 'LWIR-ASM', description: '640x512 HgCdTe cooled long-wave infrared imaging assembly', heritage: 'New', mechDrawing: 'DWG-NVA-1110-R2', elecDrawing: 'SCH-NVA-1110-R2', refDoc: 'ICD-OPT-LWIR', manufacturer: 'Photonics Labs AG', partNumber: 'PL-LWIR-640A', procurementStatus: 'Ordered', lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'Yes', notes: 'Critical-path long-lead subsystem' },
      { id: 'n_1_1_1_1', parentId: 'n_1_1_1', code: '1.1.1.1', name: 'Stirling Cryocooler & Dewar Core', deptId: 'd_eng', owner: 'S. Chen', maturity: 'CDR', milestoneId: 'ms_1', acronym: 'CRYO-FPA', description: 'Closed-cycle rotary Stirling cooler with integrated FPA dewar', heritage: 'New', mechDrawing: 'DWG-PL-8812', elecDrawing: 'SCH-PL-8812', refDoc: 'DS-PL-CRYO640', manufacturer: 'Photonics Labs AG', partNumber: 'PL-CRYO-640', procurementStatus: 'Ordered', qty: 1, mass: 3.1, powerConsumption: 26, powerDissipation: 22, mtbf: 18000, lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'Yes', leadTime: 18, unitCost: 34500, componentAlt: 'CryoTech CT-500 (20w LT)', notes: '18-week lead time; PO placed' },
      { id: 'n_1_1_1_2', parentId: 'n_1_1_1', code: '1.1.1.2', name: 'Athermalized Germanium Lens Barrel', deptId: 'd_eng', owner: 'S. Chen', maturity: 'Qualified', milestoneId: 'ms_1', acronym: 'GE-LENS', description: 'f/1.2 multi-element AR-coated Germanium objective assembly', heritage: 'Update', mechDrawing: 'DWG-OC-4420', elecDrawing: 'N/A', refDoc: 'OPT-ZEMAX-1112', manufacturer: 'OptiCoat BV', partNumber: 'OC-GE-F12', procurementStatus: 'In Transit', qty: 1, mass: 1.4, powerConsumption: 0, powerDissipation: 0, mtbf: 90000, lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'Yes', leadTime: 10, unitCost: 9800, componentAlt: 'Umicore IR-75', notes: 'Diamond-like carbon exterior coating' },
      { id: 'n_1_1_1_3', parentId: 'n_1_1_1', code: '1.1.1.3', name: 'LWIR Video Processing & Calibration PCB', deptId: 'd_eng', owner: 'E. Rostova', maturity: 'CDR', milestoneId: 'ms_1', acronym: 'LWIR-PCB', description: 'Non-uniformity correction & CameraLink/CoaXPress interface board', heritage: 'New', mechDrawing: 'DWG-NVA-1113', elecDrawing: 'SCH-NVA-1113-R3', refDoc: 'ICD-CXP-1113', manufacturer: 'EuroPCB Fab', partNumber: 'NVA-LWIR-PCB3', procurementStatus: 'In Manufacture', qty: 1, mass: 0.32, powerConsumption: 8, powerDissipation: 6.5, mtbf: 45000, lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'Yes', leadTime: 6, unitCost: 4200, componentAlt: 'None (custom)', notes: 'Conformal coated per IPC-CC-830' },
      { id: 'n_1_1_2', parentId: 'n_1_1', code: '1.1.2', name: 'Solid-State 3D LiDAR Scanner', deptId: 'd_eng', owner: 'S. Chen', maturity: 'CDR', milestoneId: 'ms_1', acronym: 'LIDAR-3D', description: '1550nm eye-safe 200m solid-state scanning LiDAR', heritage: 'New', mechDrawing: 'DWG-VB-200', elecDrawing: 'SCH-VB-200', refDoc: 'DS-VB-L3D200', manufacturer: 'VeloBeam GmbH', partNumber: 'VB-L3D-200', procurementStatus: 'Ordered', qty: 1, mass: 3.2, powerConsumption: 24, powerDissipation: 19, mtbf: 25000, lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'Yes', leadTime: 14, unitCost: 26400, componentAlt: 'Ouster OS2-128', notes: 'Includes PTPv2 hardware timestamping' },
      { id: 'n_1_1_3', parentId: 'n_1_1', code: '1.1.3', name: '2-Axis Stabilized Carbon Gimbal', deptId: 'd_des', owner: 'M. Rossi', maturity: 'PDR', milestoneId: 'ms_1', acronym: 'GIMB-2A', description: 'Carbon-fiber azimuth/elevation gyro-stabilized gimbal', heritage: 'Update', mechDrawing: 'DWG-AM-G2CF', elecDrawing: 'SCH-AM-G2CF', refDoc: 'ICD-GIMB-113', manufacturer: 'AeroMotion Sarl', partNumber: 'AM-G2-CF', procurementStatus: 'RFQ', lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'No', notes: 'Evaluating vibration resonance margin' },
      { id: 'n_1_1_3_1', parentId: 'n_1_1_3', code: '1.1.3.1', name: 'Carbon Yoke & Gimbal Structure', deptId: 'd_des', owner: 'M. Rossi', maturity: 'CDR', milestoneId: 'ms_1', acronym: 'GIMB-STR', description: 'Autoclave-cured M40J carbon-fiber yoke and inner cradle', heritage: 'New', mechDrawing: 'DWG-AM-3101', elecDrawing: 'N/A', refDoc: 'FEA-GIMB-3101', manufacturer: 'AeroMotion Sarl', partNumber: 'AM-YK-M40J', procurementStatus: 'In Manufacture', qty: 1, mass: 4.1, powerConsumption: 0, powerDissipation: 0, mtbf: 120000, lru: 'No', spareAvailable: 'No', spareToDeliver: 'No', leadTime: 12, unitCost: 11200, componentAlt: 'Al-7075 CNC Yoke (+1.9 kg)', notes: 'First-article CMM inspection scheduled' },
      { id: 'n_1_1_3_2', parentId: 'n_1_1_3', code: '1.1.3.2', name: 'Direct-Drive Brushless Torque Motors', deptId: 'd_eng', owner: 'M. Rossi', maturity: 'Qualified', milestoneId: 'ms_1', acronym: 'GIMB-MTR', description: 'Frameless hollow-shaft torque motors with 21-bit BiSS encoders', heritage: 'Existing', mechDrawing: 'DWG-KM-420', elecDrawing: 'SCH-KM-420', refDoc: 'DS-KM-TBM60', manufacturer: 'Kollmorgen EU', partNumber: 'KM-TBM60-ENC', procurementStatus: 'Received', qty: 2, mass: 1.15, powerConsumption: 9, powerDissipation: 5.5, mtbf: 65000, lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'Yes', leadTime: 8, unitCost: 4300, componentAlt: 'Maxon EC-90 Flat', notes: 'Matched pair received and bench-tested' },
      { id: 'n_1_1_4', parentId: 'n_1_1', code: '1.1.4', name: 'Tactical Fiber-Optic IMU', deptId: 'd_eng', owner: 'E. Rostova', maturity: 'Qualified', milestoneId: 'ms_1', acronym: 'FOG-IMU', description: '3-axis closed-loop fiber-optic gyroscope + MEMS accelerometer', heritage: 'Existing', mechDrawing: 'DWG-IN-FOG90', elecDrawing: 'SCH-IN-FOG90', refDoc: 'CAL-IN-FOG90', manufacturer: 'InertialNav Corp', partNumber: 'IN-FOG-90', procurementStatus: 'In Stock', qty: 1, mass: 1.1, powerConsumption: 6, powerDissipation: 5, mtbf: 50000, lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'Yes', leadTime: 10, unitCost: 15200, componentAlt: 'KVH P-1775', notes: 'Factory calibrated -40C to +70C' },

      // 1.2 Avionics & Edge Compute Core (4-5 levels deep)
      { id: 'n_1_2', parentId: 'n_1', code: '1.2', name: 'Avionics & Edge Compute Core', deptId: 'd_dat', owner: 'P. Nair', maturity: 'CDR', milestoneId: 'ms_1', acronym: 'AV-CORE', description: '3U OpenVPX rugged compute, FPGA sensor fusion, TSN networking, and encrypted storage', heritage: 'New', mechDrawing: 'DWG-NVA-1200-R3', elecDrawing: 'SCH-NVA-1200-R4', refDoc: 'ARCH-AV-120', manufacturer: 'Internal Assembly', partNumber: 'NVA-1200-01', procurementStatus: 'In Manufacture', lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'Yes', notes: 'Primary power consumption & dissipation driver' },
      { id: 'n_1_2_1', parentId: 'n_1_2', code: '1.2.1', name: 'Rugged AI Inference Compute Blade', deptId: 'd_dat', owner: 'P. Nair', maturity: 'CDR', milestoneId: 'ms_1', acronym: 'AI-VPX', description: 'Conduction-cooled 3U VPX GPU/NPU compute module (275 TOPS)', heritage: 'New', mechDrawing: 'DWG-ES-VPX8', elecDrawing: 'SCH-ES-VPX8', refDoc: 'ICD-VPX-AI8', manufacturer: 'EdgeSilicon Inc', partNumber: 'ES-VPX-AI8', procurementStatus: 'Ordered', lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'Yes', notes: '2 blades per system; primary thermal load' },
      { id: 'n_1_2_1_1', parentId: 'n_1_2_1', code: '1.2.1.1', name: 'AI Accelerator SoM Module', deptId: 'd_dat', owner: 'P. Nair', maturity: 'CDR', milestoneId: 'ms_1', acronym: 'AI-SOM', description: 'Industrial-grade 64GB LPDDR5X AI System-on-Module', heritage: 'New', mechDrawing: 'DWG-ES-SOM64', elecDrawing: 'SCH-ES-SOM64', refDoc: 'DS-ES-SOM64', manufacturer: 'EdgeSilicon Inc', partNumber: 'ES-SOM-64G', procurementStatus: 'Ordered', qty: 2, mass: 0.65, powerConsumption: 55, powerDissipation: 52, mtbf: 35000, lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'Yes', leadTime: 12, unitCost: 6900, componentAlt: 'Jetson AGX Orin Ind.', notes: 'Requires 0.25 C/W thermal interface pad' },
      { id: 'n_1_2_1_2', parentId: 'n_1_2_1', code: '1.2.1.2', name: '3U VPX Conduction Wedge-Lock Frame', deptId: 'd_eng', owner: 'M. Bellini', maturity: 'Qualified', milestoneId: 'ms_1', acronym: 'VPX-FRM', description: 'CNC 6061-T6 conduction-cooled card frame with copper heat spreader', heritage: 'Update', mechDrawing: 'DWG-NVA-1212', elecDrawing: 'N/A', refDoc: 'THERM-VPX-1212', manufacturer: 'AluCraft CNC', partNumber: 'NVA-VPX-CF2', procurementStatus: 'Received', qty: 2, mass: 1.15, powerConsumption: 10, powerDissipation: 10, mtbf: 150000, lru: 'No', spareAvailable: 'Yes', spareToDeliver: 'No', leadTime: 5, unitCost: 2500, componentAlt: 'Schroff 3U CC Frame', notes: 'Includes embedded DC-DC POL regulator' },
      { id: 'n_1_2_2', parentId: 'n_1_2', code: '1.2.2', name: 'Sensor Fusion FPGA Carrier Board', deptId: 'd_eng', owner: 'E. Rostova', maturity: 'CDR', milestoneId: 'ms_1', acronym: 'FPGA-CAR', description: 'UltraScale+ MPSoC carrier for deterministic sensor sync & pre-processing', heritage: 'New', mechDrawing: 'DWG-NVA-1220', elecDrawing: 'SCH-NVA-1220-R3', refDoc: 'ICD-FPGA-122', manufacturer: 'EuroPCB Fab', partNumber: 'NVA-FPGA-04', procurementStatus: 'In Manufacture', qty: 1, mass: 0.9, powerConsumption: 28, powerDissipation: 25, mtbf: 42000, lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'Yes', leadTime: 7, unitCost: 7800, componentAlt: 'None (custom)', notes: 'Rev C layout frozen after EMC pre-test' },
      { id: 'n_1_2_3', parentId: 'n_1_2', code: '1.2.3', name: '10GbE TSN Managed Ethernet Switch', deptId: 'd_eng', owner: 'E. Rostova', maturity: 'Qualified', milestoneId: 'ms_1', acronym: 'TSN-SW', description: '12-port IEEE 802.1Qbv time-sensitive networking 3U VPX switch', heritage: 'Existing', mechDrawing: 'DWG-NR-TSN12', elecDrawing: 'SCH-NR-TSN12', refDoc: 'DS-NR-TSN12P', manufacturer: 'NetRugged Ltd', partNumber: 'NR-TSN-12P', procurementStatus: 'Received', qty: 1, mass: 1.2, powerConsumption: 22, powerDissipation: 20, mtbf: 60000, lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'Yes', leadTime: 9, unitCost: 5600, componentAlt: 'Cisco ESS-3300', notes: 'PTPv2 grandmaster verified' },
      { id: 'n_1_2_4', parentId: 'n_1_2', code: '1.2.4', name: 'FIPS-140 Encrypted NVMe Storage Pack', deptId: 'd_ops', owner: 'L. Vance', maturity: 'Delivered', milestoneId: 'ms_1', acronym: 'NVME-ENC', description: 'Removable 8TB AES-256-XTS hardware-encrypted NVMe cartridge', heritage: 'Existing', mechDrawing: 'DWG-VF-8T', elecDrawing: 'SCH-VF-8T', refDoc: 'SEC-FIPS-140-3', manufacturer: 'VaultFlash', partNumber: 'VF-NVME-8T', procurementStatus: 'In Stock', qty: 2, mass: 0.35, powerConsumption: 8, powerDissipation: 7, mtbf: 80000, lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'Yes', leadTime: 4, unitCost: 1950, componentAlt: 'Kioxia CM7-R SED', notes: 'Zeroize pin wired to tamper switch' },

      // 1.3 Power & Thermal Management (5 levels deep on Battery Pack!)
      { id: 'n_1_3', parentId: 'n_1', code: '1.3', name: 'Power & Thermal Management', deptId: 'd_ops', owner: 'L. Vance', maturity: 'PDR', milestoneId: 'ms_2', acronym: 'PWR-THM', description: '48V energy storage, solid-state power distribution, and closed-loop liquid cooling', heritage: 'Update', mechDrawing: 'DWG-NVA-1300-R2', elecDrawing: 'SCH-NVA-1300-R2', refDoc: 'BUDGET-SWaP-130', manufacturer: 'Internal Assembly', partNumber: 'NVA-1300-01', procurementStatus: 'Ordered', lru: 'No', spareAvailable: 'No', spareToDeliver: 'No', notes: 'Thermal soak test running this week' },
      { id: 'n_1_3_1', parentId: 'n_1_3', code: '1.3.1', name: 'High-Density 48V Li-Ion Battery Pack', deptId: 'd_ops', owner: 'L. Vance', maturity: 'CDR', milestoneId: 'ms_2', acronym: 'BATT-48V', description: 'UN38.3 certified 48V 60Ah dual-pack energy storage subsystem', heritage: 'Update', mechDrawing: 'DWG-CP-4860', elecDrawing: 'SCH-CP-4860', refDoc: 'CERT-UN383-4860', manufacturer: 'CellPower Nordic', partNumber: 'CP-48V-60AH', procurementStatus: 'Ordered', lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'Yes', notes: 'Largest single mass contributor' },
      { id: 'n_1_3_1_1', parentId: 'n_1_3_1', code: '1.3.1.1', name: '21700 NMC Cell Module Sub-Pack', deptId: 'd_ops', owner: 'L. Vance', maturity: 'CDR', milestoneId: 'ms_2', acronym: 'CELL-MOD', description: '13S12P laser-welded 21700 high-energy cell brick with phase-change matrix', heritage: 'Existing', mechDrawing: 'DWG-CP-1312', elecDrawing: 'SCH-CP-1312', refDoc: 'DS-CP-NMC21700', manufacturer: 'CellPower Nordic', partNumber: 'CP-MOD-13S12P', procurementStatus: 'Ordered', lru: 'No', spareAvailable: 'No', spareToDeliver: 'No', notes: 'Contains cell bricks + thermal runaway barriers' },
      { id: 'n_1_3_1_1_1', parentId: 'n_1_3_1_1', code: '1.3.1.1.1', name: 'Matched 21700 Li-Ion Cell Array (Grade A)', deptId: 'd_ops', owner: 'L. Vance', maturity: 'Qualified', milestoneId: 'ms_2', acronym: 'CELL-217', description: '5.0Ah automotive-grade cylindrical cells, impedance-matched <2mOhm', heritage: 'Existing', mechDrawing: 'DWG-CP-CELL', elecDrawing: 'N/A', refDoc: 'QA-CELL-LOT26', manufacturer: 'CellPower Nordic', partNumber: 'CP-21700-50E', procurementStatus: 'Ordered', qty: 2, mass: 7.4, powerConsumption: 2, powerDissipation: 9, mtbf: 30000, lru: 'No', spareAvailable: 'No', spareToDeliver: 'No', leadTime: 16, unitCost: 5200, componentAlt: 'Samsung 50S / Molicel P45B', notes: '16-week sea-freight UN38.3 shipment' },
      { id: 'n_1_3_1_1_2', parentId: 'n_1_3_1_1', code: '1.3.1.1.2', name: 'Aerogel Thermal Propagation Barrier Kit', deptId: 'd_ops', owner: 'L. Vance', maturity: 'Qualified', milestoneId: 'ms_2', acronym: 'AERO-BAR', description: '2mm silica aerogel inter-cell insulation sheets for UL9540A compliance', heritage: 'New', mechDrawing: 'DWG-CP-AERO', elecDrawing: 'N/A', refDoc: 'TEST-UL9540A', manufacturer: 'AspenThermal', partNumber: 'AT-PG-2MM', procurementStatus: 'Received', qty: 2, mass: 0.45, powerConsumption: 0, powerDissipation: 0, mtbf: 200000, lru: 'No', spareAvailable: 'Yes', spareToDeliver: 'No', leadTime: 4, unitCost: 380, componentAlt: 'Mica-Silicone Sheet 2mm', notes: 'Passed nail-penetration propagation test' },
      { id: 'n_1_3_1_2', parentId: 'n_1_3_1', code: '1.3.1.2', name: 'Smart CAN-FD Battery Management System', deptId: 'd_eng', owner: 'L. Vance', maturity: 'CDR', milestoneId: 'ms_2', acronym: 'BMS-CAN', description: 'Active-balancing BMS with dual-MOSFET contactor & SOC/SOH estimator', heritage: 'New', mechDrawing: 'DWG-CP-BMS48', elecDrawing: 'SCH-CP-BMS48', refDoc: 'ICD-CANFD-BMS', manufacturer: 'CellPower Nordic', partNumber: 'CP-BMS-48V', procurementStatus: 'In Manufacture', qty: 2, mass: 0.65, powerConsumption: 3, powerDissipation: 3, mtbf: 55000, lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'Yes', leadTime: 8, unitCost: 1220, componentAlt: 'Orion BMS 2', notes: 'Firmware v2.4 adds cold-charge interlock' },
      { id: 'n_1_3_2', parentId: 'n_1_3', code: '1.3.2', name: 'Smart Solid-State Power Distribution Unit', deptId: 'd_ops', owner: 'L. Vance', maturity: 'PDR', milestoneId: 'ms_2', acronym: 'SS-PDU', description: '16-channel eFuse PDU with MIL-STD-1275 surge protection & telemetry', heritage: 'New', mechDrawing: 'DWG-NVA-1320', elecDrawing: 'SCH-NVA-1320-R2', refDoc: 'ICD-PDU-132', manufacturer: 'PowerGrid Micro', partNumber: 'NVA-PDU-28', procurementStatus: 'RFQ', qty: 1, mass: 2.4, powerConsumption: 14, powerDissipation: 18, mtbf: 48000, lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'Yes', leadTime: 8, unitCost: 4900, componentAlt: 'Vicor MIL-COTS PDU', notes: 'Awaiting final EMC filter qualification' },
      { id: 'n_1_3_3', parentId: 'n_1_3', code: '1.3.3', name: 'Closed-Loop Liquid Cold-Plate & Pump', deptId: 'd_eng', owner: 'E. Rostova', maturity: 'CDR', milestoneId: 'ms_1', acronym: 'LIQ-CPL', description: '350W glycol-water vacuum-brazed cold plate with redundant brushless pump', heritage: 'Update', mechDrawing: 'DWG-TF-350W', elecDrawing: 'SCH-TF-350W', refDoc: 'THERM-CFD-133', manufacturer: 'ThermFlow AG', partNumber: 'TF-CP-350W', procurementStatus: 'Ordered', qty: 1, mass: 5.2, powerConsumption: 42, powerDissipation: 15, mtbf: 32000, lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'Yes', leadTime: 10, unitCost: 7200, componentAlt: 'Boyd Corp LC-400', notes: 'Pressure-tested to 3.5 bar' },
      { id: 'n_1_3_4', parentId: 'n_1_3', code: '1.3.4', name: 'Finned Heat Exchanger & Dual Blowers', deptId: 'd_ops', owner: 'L. Vance', maturity: 'Qualified', milestoneId: 'ms_1', acronym: 'HX-BLW', description: 'IP68 PWM-controlled dual-blower radiator assembly', heritage: 'Existing', mechDrawing: 'DWG-TF-HX240', elecDrawing: 'SCH-TF-HX240', refDoc: 'DS-TF-HX240', manufacturer: 'ThermFlow AG', partNumber: 'TF-HX-240', procurementStatus: 'Received', qty: 1, mass: 3.1, powerConsumption: 26, powerDissipation: 9, mtbf: 45000, lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'Yes', leadTime: 6, unitCost: 2450, componentAlt: 'ebm-papst 4114N/2H8P', notes: 'Acoustic noise <54 dBA at 70% duty' },

      // 1.4 Mechanical Chassis & Harness
      { id: 'n_1_4', parentId: 'n_1', code: '1.4', name: 'Mechanical Chassis & Harness', deptId: 'd_des', owner: 'M. Bellini', maturity: 'Qualified', milestoneId: 'ms_1', acronym: 'MECH-CH', description: 'IP67 sealed structural enclosure, shock isolation, and MIL-DTL-38999 harnessing', heritage: 'Update', mechDrawing: 'DWG-NVA-1400-R5', elecDrawing: 'SCH-NVA-1400-R3', refDoc: 'ENV-MIL810H-140', manufacturer: 'AluCraft CNC', partNumber: 'NVA-1400-01', procurementStatus: 'Received', lru: 'No', spareAvailable: 'No', spareToDeliver: 'No', notes: 'Completed MIL-STD-810H shock & rain tests' },
      { id: 'n_1_4_1', parentId: 'n_1_4', code: '1.4.1', name: 'CNC Milled 6061-T6 Sealed Main Chassis', deptId: 'd_des', owner: 'M. Bellini', maturity: 'Delivered', milestoneId: 'ms_1', acronym: 'CHASSIS', description: '5-axis CNC monolith housing with EMI conductive O-ring grooves', heritage: 'New', mechDrawing: 'DWG-NVA-1410-R5', elecDrawing: 'N/A', refDoc: 'CMM-ALUCRAFT-01', manufacturer: 'AluCraft CNC', partNumber: 'NVA-CH-001', procurementStatus: 'Delivered', qty: 1, mass: 11.4, powerConsumption: 0, powerDissipation: 0, mtbf: 250000, lru: 'No', spareAvailable: 'No', spareToDeliver: 'No', leadTime: 6, unitCost: 8900, componentAlt: 'Cast Al-A356 Housing', notes: 'Hard-coat Type III anodized matte black' },
      { id: 'n_1_4_2', parentId: 'n_1_4', code: '1.4.2', name: 'Wire-Rope Vibration Isolation Mounts', deptId: 'd_des', owner: 'M. Bellini', maturity: 'Delivered', milestoneId: 'ms_1', acronym: 'VIB-MNT', description: 'Stainless 316 helical wire-rope isolators (fn = 12 Hz)', heritage: 'Existing', mechDrawing: 'DWG-VS-WR15', elecDrawing: 'N/A', refDoc: 'DS-VS-WR15', manufacturer: 'VibroStop', partNumber: 'VS-WR-15', procurementStatus: 'In Stock', qty: 4, mass: 0.6, powerConsumption: 0, powerDissipation: 0, mtbf: 200000, lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'Yes', leadTime: 3, unitCost: 420, componentAlt: 'Enidine WR4-400', notes: '4 mounts per chassis; 4 spares stocked' },
      { id: 'n_1_4_3', parentId: 'n_1_4', code: '1.4.3', name: 'MIL-DTL-38999 Shielded Wiring Harness', deptId: 'd_ops', owner: 'L. Vance', maturity: 'CDR', milestoneId: 'ms_1', acronym: 'HRN-389', description: 'Overbraided PTFE power & 10GbE Quadrax interconnect harness', heritage: 'New', mechDrawing: 'DWG-CW-HRN01', elecDrawing: 'SCH-CW-HRN01', refDoc: 'WIRELIST-NVA-04', manufacturer: 'CableWorks EU', partNumber: 'CW-NVA-HRN', procurementStatus: 'In Manufacture', qty: 1, mass: 2.9, powerConsumption: 0, powerDissipation: 2, mtbf: 100000, lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'Yes', leadTime: 8, unitCost: 5400, componentAlt: 'Glenair Mighty Mouse', notes: '100% HiPot and continuity certified' },
      { id: 'n_1_4_4', parentId: 'n_1_4', code: '1.4.4', name: 'Titanium Fastener & EMI Gasket Kit', deptId: 'd_des', owner: 'M. Bellini', maturity: 'Delivered', milestoneId: 'ms_1', acronym: 'TI-KIT', description: 'Grade 5 Ti-6Al-4V captive screws + silver-aluminum fluorosilicone gaskets', heritage: 'Existing', mechDrawing: 'DWG-FP-TIKIT', elecDrawing: 'N/A', refDoc: 'BOM-FAST-144', manufacturer: 'FastenPro', partNumber: 'FP-TI-KIT', procurementStatus: 'In Stock', qty: 1, mass: 0.4, powerConsumption: 0, powerDissipation: 0, mtbf: 250000, lru: 'No', spareAvailable: 'Yes', spareToDeliver: 'Yes', leadTime: 2, unitCost: 680, componentAlt: 'A4-80 Stainless Kit', notes: 'Nord-Lock washers included' },
    ];

    // 2. Atlas Mobile v3 (13 items, 4 nested levels, all fields populated)
    const atlasItems = [
      { id: 'a_1', parentId: null, code: '1', name: 'Atlas Mobile v3 Field Kit', deptId: 'd_eng', owner: 'M. Rossi', maturity: 'CDR', milestoneId: 'ms_3', acronym: 'ATL-KIT', description: 'Portable 5G edge gateway, rugged operator tablets, and transport case', heritage: 'Update', mechDrawing: 'DWG-ATL-0001', elecDrawing: 'SCH-ATL-0001', refDoc: 'ICD-ATL-SYS', manufacturer: 'Internal Assembly', partNumber: 'ATL-3000-01', procurementStatus: 'In Manufacture', lru: 'No', spareAvailable: 'No', spareToDeliver: 'No', notes: 'Field-ready kit for App Store v3 launch' },
      { id: 'a_1_1', parentId: 'a_1', code: '1.1', name: 'Rugged Edge Gateway Unit', deptId: 'd_eng', owner: 'A. Novak', maturity: 'CDR', milestoneId: 'ms_3', acronym: 'ATL-GW', description: 'IP67 vehicle-mountable 5G/Wi-Fi 6E edge sync gateway', heritage: 'New', mechDrawing: 'DWG-ATL-1100', elecDrawing: 'SCH-ATL-1100', refDoc: 'SPEC-ATL-GW', manufacturer: 'FieldComms', partNumber: 'ATL-1100-01', procurementStatus: 'Ordered', lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'Yes', notes: 'Supports offline queue sync' },
      { id: 'a_1_1_1', parentId: 'a_1_1', code: '1.1.1', name: 'ARM64 Cellular/5G Gateway Board', deptId: 'd_eng', owner: 'A. Novak', maturity: 'CDR', milestoneId: 'ms_3', acronym: 'GW-PCB', description: 'Quad-core Cortex-A72 mainboard with dual-SIM 5G NR modem', heritage: 'New', mechDrawing: 'DWG-FC-5GARM', elecDrawing: 'SCH-FC-5GARM', refDoc: 'DS-FC-5GARM', manufacturer: 'FieldComms', partNumber: 'FC-5G-ARM', procurementStatus: 'Ordered', lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'Yes', notes: 'Modular RF + compute carrier' },
      { id: 'a_1_1_1_1', parentId: 'a_1_1_1', code: '1.1.1.1', name: '5G NR Sub-6 M.2 Modem Card', deptId: 'd_eng', owner: 'A. Novak', maturity: 'Qualified', milestoneId: 'ms_3', acronym: 'MOD-5G', description: '3GPP Rel-16 5G NR + LTE-A Pro global bands modem', heritage: 'Existing', mechDrawing: 'DWG-QC-RM520', elecDrawing: 'SCH-QC-RM520', refDoc: 'CERT-CE-RED', manufacturer: 'Quectel EU', partNumber: 'RM520N-GL', procurementStatus: 'In Stock', qty: 1, mass: 0.08, powerConsumption: 6.5, powerDissipation: 5.2, mtbf: 85000, lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'Yes', leadTime: 6, unitCost: 410, componentAlt: 'Sierra EM9191', notes: 'CE/FCC pre-certified' },
      { id: 'a_1_1_1_2', parentId: 'a_1_1_1', code: '1.1.1.2', name: 'ARM64 Carrier & PoE+ Power Board', deptId: 'd_eng', owner: 'A. Novak', maturity: 'CDR', milestoneId: 'ms_3', acronym: 'CAR-POE', description: 'Industrial carrier PCB with 802.3at PoE+ and TPM 2.0', heritage: 'New', mechDrawing: 'DWG-FC-CAR2', elecDrawing: 'SCH-FC-CAR2', refDoc: 'ICD-FC-POE', manufacturer: 'FieldComms', partNumber: 'FC-CAR-POE2', procurementStatus: 'In Manufacture', qty: 1, mass: 0.37, powerConsumption: 5.5, powerDissipation: 4.8, mtbf: 70000, lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'Yes', leadTime: 8, unitCost: 1040, componentAlt: 'None (custom)', notes: 'Wide 9-36V automotive input' },
      { id: 'a_1_1_2', parentId: 'a_1_1', code: '1.1.2', name: 'IP67 Die-Cast Aluminum Enclosure', deptId: 'd_des', owner: 'M. Bellini', maturity: 'Qualified', milestoneId: 'ms_3', acronym: 'GW-ENC', description: 'Finned passive-cooled aluminum housing with Gore vent', heritage: 'Update', mechDrawing: 'DWG-ATL-1120', elecDrawing: 'N/A', refDoc: 'IP67-TEST-112', manufacturer: 'AluCraft CNC', partNumber: 'ATL-ENC-03', procurementStatus: 'Received', qty: 1, mass: 1.65, powerConsumption: 0, powerDissipation: 0, mtbf: 200000, lru: 'No', spareAvailable: 'Yes', spareToDeliver: 'No', leadTime: 5, unitCost: 620, componentAlt: 'Hammond 1590Z', notes: 'Tooling paid under external costs' },
      { id: 'a_1_1_3', parentId: 'a_1_1', code: '1.1.3', name: 'MIMO 5G + GNSS Dome Antenna', deptId: 'd_eng', owner: 'A. Novak', maturity: 'Delivered', milestoneId: 'ms_3', acronym: 'ANT-5G', description: '4x4 MIMO 5G + 2x2 Wi-Fi + active L1/L5 GNSS radome', heritage: 'Existing', mechDrawing: 'DWG-AX-MIMO', elecDrawing: 'SCH-AX-MIMO', refDoc: 'DS-AX-MIMO5G', manufacturer: 'Antennix', partNumber: 'AX-MIMO-5G', procurementStatus: 'In Stock', qty: 1, mass: 0.55, powerConsumption: 1.5, powerDissipation: 1, mtbf: 120000, lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'Yes', leadTime: 4, unitCost: 390, componentAlt: 'Panorama LGMDM4', notes: 'Low-loss LMR-195 pigtails' },
      { id: 'a_1_2', parentId: 'a_1', code: '1.2', name: 'Operator Rugged Tablet & Dock', deptId: 'd_des', owner: 'M. Bellini', maturity: 'Delivered', milestoneId: 'ms_3', acronym: 'OP-TAB', description: 'Dual operator tablets with vehicle charging cradles', heritage: 'Existing', mechDrawing: 'DWG-RT-SYS', elecDrawing: 'SCH-RT-SYS', refDoc: 'UG-ATLAS-TAB', manufacturer: 'RuggedTab Co', partNumber: 'RT-KIT-10', procurementStatus: 'Delivered', lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'Yes', notes: 'UI kit signed off for sunlight readability' },
      { id: 'a_1_2_1', parentId: 'a_1_2', code: '1.2.1', name: 'Sunlight-Readable 10" Field Tablet', deptId: 'd_des', owner: 'M. Bellini', maturity: 'Delivered', milestoneId: 'ms_3', acronym: 'TAB-10', description: '1200-nit glove-touch MIL-STD-810H tablet with hot-swap battery', heritage: 'Existing', mechDrawing: 'DWG-RT-10PRO', elecDrawing: 'SCH-RT-10PRO', refDoc: 'DS-RT-10PRO', manufacturer: 'RuggedTab Co', partNumber: 'RT-10-PRO', procurementStatus: 'Delivered', qty: 2, mass: 1.15, powerConsumption: 18, powerDissipation: 14, mtbf: 40000, lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'Yes', leadTime: 6, unitCost: 2350, componentAlt: 'Panasonic Toughbook G2', notes: 'Pre-loaded with Atlas Mobile v3' },
      { id: 'a_1_2_2', parentId: 'a_1_2', code: '1.2.2', name: 'Vehicle Charging & Ethernet Cradle', deptId: 'd_des', owner: 'M. Rossi', maturity: 'Delivered', milestoneId: 'ms_3', acronym: 'TAB-DCK', description: 'Locking pogo-pin dock with GbE pass-through & 12/24V charger', heritage: 'Existing', mechDrawing: 'DWG-RT-DOCK2', elecDrawing: 'SCH-RT-DOCK2', refDoc: 'DS-RT-DOCK2', manufacturer: 'RuggedTab Co', partNumber: 'RT-DOCK-V2', procurementStatus: 'Delivered', qty: 2, mass: 0.9, powerConsumption: 4, powerDissipation: 3, mtbf: 75000, lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'No', leadTime: 4, unitCost: 480, componentAlt: 'Gamber-Johnson Dock', notes: 'RAM-mount VESA 75 compatible' },
      { id: 'a_1_3', parentId: 'a_1', code: '1.3', name: 'Pelican-Style Foam Transport Case', deptId: 'd_ops', owner: 'L. Vance', maturity: 'Delivered', milestoneId: 'ms_3', acronym: 'TRN-CAS', description: 'Watertight crushproof case with CNC-routed closed-cell foam', heritage: 'Existing', mechDrawing: 'DWG-CG-1560', elecDrawing: 'N/A', refDoc: 'PACK-ATL-13', manufacturer: 'CaseGuard', partNumber: 'CG-1560-FOAM', procurementStatus: 'In Stock', qty: 1, mass: 4.8, powerConsumption: 0, powerDissipation: 0, mtbf: 250000, lru: 'No', spareAvailable: 'No', spareToDeliver: 'No', leadTime: 2, unitCost: 540, componentAlt: 'Pelican 1560 Protector', notes: 'IATA carry-on compliant' },
    ];

    // 3. Cloud EU Migration (9 items, 4 nested levels, all fields populated)
    const cloudItems = [
      { id: 'c_1', parentId: null, code: '1', name: 'Frankfurt Sovereign HA Cluster', deptId: 'd_ops', owner: 'E. Rostova', maturity: 'CDR', milestoneId: 'ms_2', acronym: 'EU-CLD', description: 'Dedicated EU-hosted high-availability compute, storage, and HSM rack', heritage: 'New', mechDrawing: 'DWG-CLD-RACK1', elecDrawing: 'SCH-CLD-PWR1', refDoc: 'ARCH-EU-FAILOVER', manufacturer: 'EU Sovereign Cloud', partNumber: 'EUSC-RACK-FRA1', procurementStatus: 'Ordered', lru: 'No', spareAvailable: 'No', spareToDeliver: 'No', notes: 'Awaiting EU legal sign-off on failover' },
      { id: 'c_1_1', parentId: 'c_1', code: '1.1', name: 'Compute & Virtualization Nodes', deptId: 'd_eng', owner: 'E. Rostova', maturity: 'CDR', milestoneId: 'ms_2', acronym: 'CMP-NOD', description: 'Dual-socket 2U Kubernetes/VM host servers (N+1 redundant)', heritage: 'Update', mechDrawing: 'DWG-CLD-110', elecDrawing: 'SCH-CLD-110', refDoc: 'SPEC-K8S-FRA', manufacturer: 'EuroServer AG', partNumber: 'ES-2U-EPYC96', procurementStatus: 'Ordered', qty: 4, mass: 22.5, powerConsumption: 680, powerDissipation: 640, mtbf: 50000, lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'No', leadTime: 8, unitCost: 14800, componentAlt: 'Dell PowerEdge R7625', notes: '4 nodes active-active across 2 AZs' },
      { id: 'c_1_2', parentId: 'c_1', code: '1.2', name: 'All-Flash NVMe Replication Array', deptId: 'd_ops', owner: 'L. Vance', maturity: 'CDR', milestoneId: 'ms_2', acronym: 'STR-NVME', description: 'Synchronous multi-AZ NVMe-oF storage cluster (120TB usable)', heritage: 'New', mechDrawing: 'DWG-CLD-120', elecDrawing: 'SCH-CLD-120', refDoc: 'RPO-RTO-PLAN', manufacturer: 'DataVault EU', partNumber: 'DV-AF-120T', procurementStatus: 'Ordered', qty: 2, mass: 28.0, powerConsumption: 520, powerDissipation: 490, mtbf: 65000, lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'No', leadTime: 10, unitCost: 24500, componentAlt: 'NetApp AFF A250', notes: 'RPO = 0s synchronous mirror' },
      { id: 'c_1_3', parentId: 'c_1', code: '1.3', name: 'Security & Network Fabric', deptId: 'd_ops', owner: 'L. Vance', maturity: 'Qualified', milestoneId: 'ms_2', acronym: 'SEC-FAB', description: 'FIPS 140-3 HSMs, 100GbE leaf-spine switches, and DWDM optics', heritage: 'New', mechDrawing: 'DWG-CLD-130', elecDrawing: 'SCH-CLD-130', refDoc: 'SEC-EU-GDPR', manufacturer: 'Internal Assembly', partNumber: 'CLD-1300-01', procurementStatus: 'In Manufacture', lru: 'No', spareAvailable: 'No', spareToDeliver: 'No', notes: 'Zero-trust mTLS mesh' },
      { id: 'c_1_3_1', parentId: 'c_1_3', code: '1.3.1', name: 'FIPS 140-3 Network HSM Appliance', deptId: 'd_ops', owner: 'L. Vance', maturity: 'Qualified', milestoneId: 'ms_2', acronym: 'HSM-EU', description: 'Tamper-responsive key management HSM for EU customer keys', heritage: 'Existing', mechDrawing: 'DWG-TH-HSM7', elecDrawing: 'SCH-TH-HSM7', refDoc: 'CERT-FIPS140-3', manufacturer: 'Thales EU', partNumber: 'LUNA-A790', procurementStatus: 'Received', qty: 2, mass: 11.2, powerConsumption: 145, powerDissipation: 135, mtbf: 90000, lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'No', leadTime: 12, unitCost: 28500, componentAlt: 'Utimaco SecurityServer', notes: 'HA pair with smartcard quorum' },
      { id: 'c_1_3_2', parentId: 'c_1_3', code: '1.3.2', name: '100GbE Top-of-Rack Leaf Switch', deptId: 'd_ops', owner: 'L. Vance', maturity: 'Delivered', milestoneId: 'ms_2', acronym: 'TOR-100G', description: '32-port QSFP28 100GbE redundant-PSU datacenter switch', heritage: 'Existing', mechDrawing: 'DWG-AR-7060', elecDrawing: 'SCH-AR-7060', refDoc: 'NET-TOP-FRA', manufacturer: 'Arista EU', partNumber: 'DCS-7060CX-32S', procurementStatus: 'In Stock', qty: 2, mass: 9.8, powerConsumption: 240, powerDissipation: 225, mtbf: 110000, lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'No', leadTime: 6, unitCost: 11400, componentAlt: 'Cisco Nexus 93180YC', notes: 'MLAG active-active pair' },
      { id: 'c_1_4', parentId: 'c_1', code: '1.4', name: 'Dual-Feed Metered Rack PDU & UPS', deptId: 'd_ops', owner: 'L. Vance', maturity: 'Delivered', milestoneId: 'ms_2', acronym: 'RACK-UPS', description: 'A+B 32A 3-phase intelligent PDU pair with 10kVA online UPS', heritage: 'Existing', mechDrawing: 'DWG-APC-10K', elecDrawing: 'SCH-APC-10K', refDoc: 'PWR-FAILOVER-02', manufacturer: 'Schneider EU', partNumber: 'SRT10KXLI-PDU', procurementStatus: 'Delivered', qty: 2, mass: 34.0, powerConsumption: 180, powerDissipation: 165, mtbf: 80000, lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'No', leadTime: 4, unitCost: 6200, componentAlt: 'Eaton 9PX 11kVA', notes: 'Tested with backup diesel generator' },
    ];

    // 4. AI Copilot Analytics (7 items, 3 nested levels, all fields populated)
    const pulseItems = [
      { id: 'p_1', parentId: null, code: '1', name: 'AI Copilot Inference Appliance', deptId: 'd_dat', owner: 'P. Nair', maturity: 'PDR', milestoneId: 'ms_4', acronym: 'AIC-APP', description: 'On-premise high-throughput LLM & analytics inference rack', heritage: 'New', mechDrawing: 'DWG-AIC-001', elecDrawing: 'SCH-AIC-001', refDoc: 'ARCH-COPILOT-GA', manufacturer: 'Internal Assembly', partNumber: 'AIC-1000-01', procurementStatus: 'RFQ', lru: 'No', spareAvailable: 'No', spareToDeliver: 'No', notes: 'Evaluating quantized model footprint' },
      { id: 'p_1_1', parentId: 'p_1', code: '1.1', name: '4U 8xGPU Inference Server Node', deptId: 'd_dat', owner: 'P. Nair', maturity: 'PDR', milestoneId: 'ms_4', acronym: 'GPU-NODE', description: '8x H100 SXM5 NVLink server with 2TB DDR5 host memory', heritage: 'New', mechDrawing: 'DWG-SM-4U8G', elecDrawing: 'SCH-SM-4U8G', refDoc: 'BENCH-P95-100K', manufacturer: 'SuperMicro EU', partNumber: 'SYS-821GE-TNHR', procurementStatus: 'Ordered', qty: 2, mass: 68.5, powerConsumption: 6400, powerDissipation: 6100, mtbf: 30000, lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'No', leadTime: 16, unitCost: 145000, componentAlt: 'HGX B200 8-GPU', notes: 'Primary cost & power driver' },
      { id: 'p_1_2', parentId: 'p_1', code: '1.2', name: '400Gb/s InfiniBand Fabric Switch', deptId: 'd_dat', owner: 'D. Park', maturity: 'CDR', milestoneId: 'ms_4', acronym: 'IB-400G', description: '64-port NDR 400Gb/s low-latency GPU interconnect switch', heritage: 'Existing', mechDrawing: 'DWG-NV-QM97', elecDrawing: 'SCH-NV-QM97', refDoc: 'NET-IB-NDR', manufacturer: 'NVIDIA Net', partNumber: 'MQM9700-NS2F', procurementStatus: 'Ordered', qty: 1, mass: 14.2, powerConsumption: 740, powerDissipation: 700, mtbf: 75000, lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'No', leadTime: 10, unitCost: 22800, componentAlt: 'Arista 7060X5 400G', notes: 'RDMA RoCE/IB verified' },
      { id: 'p_1_3', parentId: 'p_1', code: '1.3', name: 'Direct-to-Chip Coolant Distribution Unit', deptId: 'd_ops', owner: 'L. Vance', maturity: 'PDR', milestoneId: 'ms_4', acronym: 'CDU-LIQ', description: '4U 80kW in-rack liquid-to-liquid CDU with redundant pumps', heritage: 'New', mechDrawing: 'DWG-VT-CDU80', elecDrawing: 'SCH-VT-CDU80', refDoc: 'THERM-RACK-AIC', manufacturer: 'Vertiv EU', partNumber: 'XDU080-RACK', procurementStatus: 'RFQ', qty: 1, mass: 46.0, powerConsumption: 950, powerDissipation: 320, mtbf: 45000, lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'No', leadTime: 12, unitCost: 18500, componentAlt: 'CoolIT CHx80', notes: 'Supports 25C facility water' },
      { id: 'p_1_4', parentId: 'p_1', code: '1.4', name: 'Model Registry & Telemetry Appliance', deptId: 'd_dat', owner: 'D. Park', maturity: 'Qualified', milestoneId: 'ms_4', acronym: 'REG-SRV', description: '1U Prometheus/MLflow artifact & GDPR audit logging server', heritage: 'Existing', mechDrawing: 'DWG-ES-1U32', elecDrawing: 'SCH-ES-1U32', refDoc: 'GDPR-AUDIT-AIC', manufacturer: 'EuroServer AG', partNumber: 'ES-1U-REG32', procurementStatus: 'Received', qty: 1, mass: 12.4, powerConsumption: 210, powerDissipation: 195, mtbf: 85000, lru: 'Yes', spareAvailable: 'Yes', spareToDeliver: 'No', leadTime: 4, unitCost: 4800, componentAlt: 'Dell PowerEdge R660', notes: 'PII redaction pipeline deployed' },
    ];

    return {
      p_nova: mkDoc('p_nova', 'NVA', 'Project Nova (Core Platform)', novaItems),
      p_atlas: mkDoc('p_atlas', 'ATL', 'Atlas Mobile v3', atlasItems),
      p_cloud: mkDoc('p_cloud', 'CLD', 'Cloud EU Migration', cloudItems),
      p_pulse: mkDoc('p_pulse', 'AIC', 'AI Copilot Analytics', pulseItems),
    };
  }

  const getCache = () => {
    if (isDemoMode()) return (S.demoCache || (S.demoCache = buildDemoPbsCache()));
    return (S.cache || (S.cache = D().loadCache()));
  };
  const persistCache = () => {
    if (isDemoMode()) return;
    D().saveCache(getCache());
  };
  const fileNameFor = (projectId = S.activeProjectId) => D().getPbsFilename(getProject(projectId), projectId);

  function withPbsTimeout(promise, ms = IO_TIMEOUT_MS, label = 'PBS folder operation timed out') {
    let timer = null;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const e = new Error(label);
          e.name = 'TimeoutError';
          reject(e);
        }, ms);
      }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
  }

  function isPbsConnectionError(err) {
    if (!err) return false;
    if (typeof isConnectionLostError === 'function' && isConnectionLostError(err)) return true;
    const name = String(err.name || '');
    const msg = String(err.message || '').toLowerCase();
    return ['NotFoundError', 'NotReadableError', 'NotAllowedError', 'SecurityError', 'InvalidStateError', 'NoModificationAllowedError', 'TimeoutError'].includes(name)
      || msg.includes('permission') || msg.includes('timed out') || msg.includes('disconnected');
  }

  async function readRawFileText(file) {
    if (typeof ppReadRawFileText === 'function') return ppReadRawFileText(file);
    return file.text();
  }

  function extractWriteId(rawText) {
    try {
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed === 'object') {
        if (parsed.writeId) return String(parsed.writeId);
        if (parsed.meta && parsed.meta.lastWriteId) return String(parsed.meta.lastWriteId);
      }
    } catch (_e) {}
    return '';
  }

  function setSyncStatus(text, tone) {
    S.syncStatusText = text;
    S.syncStatusTone = tone || 'idle';
    S.hooks.onStatus(S.syncStatusText, S.syncStatusTone);
  }

  function syncPbsMetaToMainDb(dirHandle) {
    const db = getLiveDbRef();
    if (!db || typeof db !== 'object' || !dirHandle) return;
    if (!db.settings || typeof db.settings !== 'object') db.settings = {};
    db.settings.pbsFolder = {
      enabled: true,
      folderName: String(dirHandle.name || '').trim(),
      folderPath: String(dirHandle.name || '').trim(),
      linkedAt: new Date().toISOString(),
    };
    if (typeof touchDBAndSave === 'function') touchDBAndSave();
  }

  /* ---------- ChangeLog & owner suggestions ---------- */
  function logChange(summary) {
    const db = getDb();
    if (!db || !Array.isArray(db.changeLog)) return;
    const proj = getProject(S.activeProjectId);
    const label = proj ? `[${proj.code || proj.id}] ${proj.name}` : S.activeProjectId;
    db.changeLog.unshift({
      id: typeof uid === 'function' ? uid('log') : D().makeId('log'),
      timestamp: new Date().toISOString(), user: getUserName(), type: 'PBS', summary: `${label}: ${summary}`,
    });
    if (db.changeLog.length > 300) db.changeLog.length = 300;
    if (typeof touchDBAndSave === 'function') touchDBAndSave();
  }

  function getOwnerSuggestions() {
    const names = new Set();
    const add = (v) => { const t = String(v || '').trim(); if (t) names.add(t); };
    const db = getDb();
    (db.peopleDirectory || []).forEach(p => p && add(p.name));
    try {
      const raw = typeof safeGetStorage === 'function' ? safeGetStorage(PEOPLE_KEY) : localStorage.getItem(PEOPLE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) parsed.forEach(p => p && add(p.name));
    } catch (_e) {}
    (db.projects || []).forEach(p => { if (p) { add(p.owner); add(p.techLead); } });
    (db.departments || []).forEach(d => d && add(d.manager));
    if (S.activeDoc) S.activeDoc.items.forEach(it => add(it.owner));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  function getManufacturerSuggestions() {
    const names = new Set();
    const add = (v) => { const t = String(v || '').trim(); if (t) names.add(t); };
    const cache = getCache();
    Object.keys(cache).forEach(pid => {
      const d = cache[pid];
      if (d && Array.isArray(d.items)) d.items.forEach(it => it && add(it.manufacturer));
    });
    if (S.activeDoc && Array.isArray(S.activeDoc.items)) S.activeDoc.items.forEach(it => it && add(it.manufacturer));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  function getProcStatusSuggestions() {
    const presets = (P.PROC_STATUS_PRESETS || ['Not Started', 'RFQ', 'Ordered', 'In Manufacture', 'In Transit', 'Received', 'In Stock', 'Delivered']);
    const seen = new Set(presets.map(s => s.toLowerCase()));
    const extras = [];
    const add = (v) => {
      const t = String(v || '').trim();
      if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); extras.push(t); }
    };
    const cache = getCache();
    Object.keys(cache).forEach(pid => {
      const d = cache[pid];
      if (d && Array.isArray(d.items)) d.items.forEach(it => it && add(it.procurementStatus));
    });
    if (S.activeDoc && Array.isArray(S.activeDoc.items)) S.activeDoc.items.forEach(it => it && add(it.procurementStatus));
    return [...presets, ...extras.sort((a, b) => a.localeCompare(b))];
  }

  /* ---------- Remembered folder handle (IndexedDB, Chrome/Edge) ---------- */
  function openHandleDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function saveRememberedDirHandle(handle) {
    let db = null;
    try {
      db = await withPbsTimeout(openHandleDb(), 5000, 'PBS IDB open timed out');
      if (!db) return;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(handle, IDB_DIR_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (_e) {
    } finally {
      try { if (db) db.close(); } catch (_e) {}
    }
  }
  async function loadRememberedDirHandle() {
    let db = null;
    try {
      db = await withPbsTimeout(openHandleDb(), 5000, 'PBS IDB open timed out');
      if (!db) return null;
      return await new Promise((resolve) => {
        const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_DIR_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (_e) {
      return null;
    } finally {
      try { if (db) db.close(); } catch (_e) {}
    }
  }
  async function ensureDirPermission(handle, promptUser) {
    if (!handle || typeof handle.queryPermission !== 'function') return Boolean(handle);
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if (promptUser && typeof handle.requestPermission === 'function') {
      try {
        return (await handle.requestPermission(opts)) === 'granted';
      } catch (err) {
        if (err && err.name === 'SecurityError') return false;
        throw err;
      }
    }
    return false;
  }

  /* ---------- Session ---------- */
  function openSession(projectId) {
    const project = getProject(projectId);
    if (!project) return null;
    S.activeProjectId = projectId;
    S.activeFileModified = 0;
    S.lastWrittenId = '';
    S.saveQueued = false;
    S.activeWasEncrypted = Boolean(getSessionPassphrase());
    S.conflictRemoteText = null; S.conflictRemoteDoc = null; S.conflictRemoteModified = 0;
    const cached = getCache()[projectId];
    S.activeDoc = (cached && D().normalizePbsDoc(cached, project, getUserName())) || D().createEmptyPbs(project, getUserName(), projectId);
    if (isDemoMode()) {
      setSyncStatus('Demo PBS (in-memory)', 'idle');
    } else {
      setSyncStatus(S.dirHandle ? `Synced (${fileNameFor()})` : 'Saved locally in browser', S.dirHandle ? 'ok' : 'idle');
    }
    return S.activeDoc;
  }

  /* Restores a previously linked folder (optionally prompting inside a user gesture) and loads the active project's file from it. */
  async function initFolder(opts = {}) {
    if (isDemoMode()) {
      S.hooks.onBadges();
      return;
    }
    const allowPrompt = Boolean(opts && opts.allowPrompt);
    if (!S.dirHandle && supportsDirSync()) {
      if (!S.rememberedDirHandle) {
        S.rememberedDirHandle = await loadRememberedDirHandle();
      }
      if (S.rememberedDirHandle && await ensureDirPermission(S.rememberedDirHandle, allowPrompt)) {
        S.dirHandle = S.rememberedDirHandle;
      }
    }
    if (S.dirHandle) {
      await syncFromFolder({ silentMissing: true, silentErrors: true });
      await scanFolderForBadges({ force: false });
      startPolling();
    } else {
      S.hooks.onBadges();
    }
  }

  async function tryAutoReconnectFolder(opts = {}) {
    if (isSessionLocked()) return false;
    const allowPrompt = Boolean(opts && opts.allowPrompt);
    if (!S.dirHandle && supportsDirSync()) {
      if (!S.rememberedDirHandle) S.rememberedDirHandle = await loadRememberedDirHandle();
      if (S.rememberedDirHandle && await ensureDirPermission(S.rememberedDirHandle, allowPrompt)) {
        S.dirHandle = S.rememberedDirHandle;
      }
    }
    if (S.dirHandle) {
      await scanFolderForBadges({ force: Boolean(opts && opts.force) });
      startPolling();
      S.hooks.onBadges();
      return true;
    }
    S.hooks.onBadges();
    return false;
  }

  async function scanFolderForBadges(opts = {}) {
    if (!S.dirHandle || isSessionLocked()) return 0;
    if (S.isBackgroundScanning) return 0;
    S.isBackgroundScanning = true;
    S.lastBackgroundPollAt = Date.now();
    const force = Boolean(opts && opts.force);
    const skipActive = Boolean(opts && opts.skipActive);
    const projects = getDb().projects || [];
    const cache = getCache();
    let updated = 0;
    try {
      for (const p of projects) {
        if (!p || !p.id || isSessionLocked() || !S.dirHandle) break;
        if (S.dirtyProjectIds.has(p.id)) continue;
        if (skipActive && p.id === S.activeProjectId) continue;
        if (p.id === S.activeProjectId && S.hooks.isDialogOpen() && (S.isSaving || S.saveTimer || S.saveQueued || S.conflictRemoteText)) continue;
        try {
          const fname = D().getPbsFilename(p, p.id);
          const fh = await withPbsTimeout(S.dirHandle.getFileHandle(fname, { create: false }), IO_TIMEOUT_MS);
          const file = await withPbsTimeout(fh.getFile(), IO_TIMEOUT_MS);
          const fileMod = Number(file.lastModified || 0);
          const knownMod = S.folderFileMtimes.get(p.id);
          if (!force && cache[p.id] && knownMod && fileMod > 0 && Math.abs(fileMod - knownMod) <= 500) {
            continue;
          }
          const raw = await readRawFileText(file);
          const { doc } = await D().decodePbsFromText(raw, p, undefined, getUserName(), { silentPrompt: true });
          if (!isSessionLocked()) {
            cache[p.id] = doc;
            S.folderFileMtimes.set(p.id, fileMod);
            if (p.id === S.activeProjectId && !S.hooks.isDialogOpen()) {
              S.activeDoc = doc;
              S.activeFileModified = fileMod;
            }
            updated++;
          }
        } catch (err) {
          if (err && err.name === 'NotFoundError') {
            if (S.folderFileMtimes.has(p.id)) {
              S.folderFileMtimes.delete(p.id);
              if (cache[p.id]) {
                delete cache[p.id];
                updated++;
              }
            }
          } else if (isPbsConnectionError(err)) {
            handlePbsFolderDisconnected(err, { silent: !S.hooks.isDialogOpen() });
            break;
          }
          // Undecryptable without key or transient per-file error — skip silently
        }
      }
      if (updated > 0 && !isSessionLocked()) {
        persistCache();
        S.hooks.onBadges();
      }
      return updated;
    } finally {
      S.isBackgroundScanning = false;
    }
  }

  function replaceDoc(doc, wasEncrypted) {
    S.activeDoc = doc;
    S.activeWasEncrypted = Boolean(wasEncrypted) || Boolean(getSessionPassphrase());
    S.conflictRemoteText = null; S.conflictRemoteDoc = null;
    getCache()[S.activeProjectId] = doc;
    persistCache();
    S.hooks.onBadges();
  }

  function handlePbsFolderDisconnected(err, opts = {}) {
    stopPolling();
    if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; }
    S.saveQueued = false;
    const lostHandle = S.dirHandle;
    S.dirHandle = null;
    const isPerm = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    if (isPerm && lostHandle) S.rememberedDirHandle = lostHandle;
    setSyncStatus('PBS folder disconnected \u2014 reconnect to sync', 'error');
    if (!opts.silent) {
      toast('PBS shared folder connection lost. Reconnect the PBS folder to resume syncing.', 'warning');
    }
    S.hooks.rerender();
    S.hooks.onBadges();
  }

  /* ---------- Folder link / read / write ---------- */
  async function afterFolderConnected() {
    toast(`Linked PBS folder: ${S.dirHandle.name}`, 'success');
    syncPbsMetaToMainDb(S.dirHandle);
    S.folderFileMtimes.clear();
    if (S.activeProjectId && S.hooks.isDialogOpen()) {
      const localItems = (S.activeDoc && Array.isArray(S.activeDoc.items)) ? S.activeDoc.items : [];
      const hadLocalDirty = S.dirtyProjectIds.has(S.activeProjectId) || localItems.length > 0;
      const existingFh = await getFileHandle(false).catch(() => null);
      if (existingFh && hadLocalDirty && localItems.length > 0) {
        // Inspect disk first so linking a folder NEVER silently wipes unsaved local items!
        try {
          const file = await withPbsTimeout(existingFh.getFile(), IO_TIMEOUT_MS);
          const remoteText = await readRawFileText(file);
          const { doc: remoteDoc } = await D().decodePbsFromText(remoteText, getProject(S.activeProjectId), undefined, getUserName(), { silentPrompt: true });
          const diff = D().computeConflictDiff(S.activeDoc, remoteDoc, getDb());
          const differs = diff.addedRemote.length > 0 || diff.modifiedBoth.length > 0 || diff.onlyLocal.length > 0;
          if (differs) {
            S.conflictRemoteText = remoteText;
            S.conflictRemoteDoc = remoteDoc;
            S.conflictRemoteModified = file.lastModified || Date.now();
            setSyncStatus('Folder file differs from local items \u2014 choose merge, load, or overwrite', 'warn');
            S.hooks.rerender();
            startPolling();
            await scanFolderForBadges({ force: true, skipActive: true });
            S.hooks.onBadges();
            return;
          }
        } catch (_e) {
          // Fall through to normal syncFromFolder
        }
      }
      const loaded = await syncFromFolder({ silentMissing: true });
      if (!loaded && S.activeDoc && S.activeDoc.items.length > 0) await writeToFolder(false);
      S.hooks.rerender();
    }
    await scanFolderForBadges({ force: true, skipActive: Boolean(S.activeProjectId && S.hooks.isDialogOpen()) });
    startPolling();
    S.hooks.onBadges();
  }

  async function linkFolder() {
    if (!supportsDirSync()) { toast('Direct folder auto-sync requires desktop Chrome or Edge. Use Save / Load JSON in other browsers.', 'info'); return; }
    try {
      const handle = await window.showDirectoryPicker({ id: 'pulseplan-pbs-folder', mode: 'readwrite' });
      if (!(await ensureDirPermission(handle, true))) { toast('Folder permission was not granted.', 'warning'); return; }
      S.dirHandle = handle; S.rememberedDirHandle = handle;
      await saveRememberedDirHandle(handle);
      await afterFolderConnected();
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      toast((err && err.message) || 'Could not link PBS folder.', 'error');
    }
  }

  async function reconnectFolder() {
    if (!S.rememberedDirHandle) return linkFolder();
    try {
      if (!(await ensureDirPermission(S.rememberedDirHandle, true))) { toast('Folder permission not granted.', 'warning'); return; }
      S.dirHandle = S.rememberedDirHandle;
      await afterFolderConnected();
    } catch (_e) { await linkFolder(); }
  }

  async function getFileHandleForName(fname, create) {
    if (!S.dirHandle || !fname) return null;
    try {
      return await withPbsTimeout(S.dirHandle.getFileHandle(fname, { create: Boolean(create) }), IO_TIMEOUT_MS);
    } catch (err) {
      if (!create && err && err.name === 'NotFoundError') return null;
      throw err;
    }
  }

  async function getFileHandle(create) {
    if (!S.dirHandle || !S.activeProjectId) return null;
    return getFileHandleForName(fileNameFor(), create);
  }

  async function syncFromFolder(opts = {}) {
    if (!S.dirHandle || !S.activeProjectId || isSessionLocked()) return false;
    const targetProjectId = S.activeProjectId;
    const targetFileName = fileNameFor(targetProjectId);
    const project = getProject(targetProjectId);
    try {
      const fh = await getFileHandleForName(targetFileName, false);
      if (!fh) {
        if (S.activeProjectId === targetProjectId) S.activeFileModified = 0;
        if (!opts.silentMissing) toast(`No existing ${targetFileName} in folder yet. First edit will create it.`, 'info');
        return false;
      }
      const file = await withPbsTimeout(fh.getFile(), IO_TIMEOUT_MS);
      const rawText = await readRawFileText(file);
      const { doc, wasEncrypted } = await D().decodePbsFromText(rawText, project, undefined, getUserName(), {
        silentPrompt: Boolean(opts.silentErrors),
      });
      if (isSessionLocked() || S.activeProjectId !== targetProjectId) return false;
      S.activeDoc = doc;
      const loadedMod = Number(file.lastModified || 0);
      S.activeFileModified = loadedMod;
      S.folderFileMtimes.set(targetProjectId, loadedMod);
      S.lastWrittenId = extractWriteId(rawText) || (doc.meta && doc.meta.lastWriteId) || '';
      S.activeWasEncrypted = wasEncrypted || Boolean(getSessionPassphrase());
      S.dirtyProjectIds.delete(targetProjectId);
      getCache()[targetProjectId] = doc;
      persistCache();
      S.conflictRemoteText = null; S.conflictRemoteDoc = null; S.conflictRemoteModified = 0;
      setSyncStatus(`${S.activeWasEncrypted ? 'Encrypted & synced' : 'Synced'} (${targetFileName})`, 'ok');
      S.hooks.onBadges();
      return true;
    } catch (err) {
      if (isPbsConnectionError(err) && err.name !== 'NotFoundError') {
        handlePbsFolderDisconnected(err);
      } else {
        setSyncStatus((err && err.message) || 'Sync read failed', 'error');
        if (!opts.silentErrors) toast((err && err.message) || 'Could not read PBS file from folder.', 'error');
      }
      return false;
    }
  }

  async function writeToFolder(forceOverwrite) {
    if (isSessionLocked() && !S.isFlushingForLock) return false;
    if (!S.dirHandle || !S.activeProjectId || !S.activeDoc) return false;
    if (S.isSaving) {
      S.saveQueued = true;
      return false;
    }
    S.isSaving = true;
    S.saveQueued = false;

    const targetProjectId = S.activeProjectId;
    const targetFileName = fileNameFor(targetProjectId);
    const project = getProject(targetProjectId);
    const docClone = JSON.parse(JSON.stringify(S.activeDoc));
    const requireEnc = S.activeWasEncrypted || Boolean(getSessionPassphrase());
    const knownModified = S.activeFileModified;
    const knownWriteId = S.lastWrittenId || (docClone.meta && docClone.meta.lastWriteId) || '';

    try {
      if (!forceOverwrite) {
        const existingFh = await getFileHandleForName(targetFileName, false);
        if (existingFh) {
          const existing = await withPbsTimeout(existingFh.getFile(), IO_TIMEOUT_MS);
          const existingMod = Number(existing.lastModified || 0);
          const remoteChanged = (knownModified > 0 && existingMod > knownModified + 500);
          const newlyCreatedRemote = (knownModified === 0);
          if (remoteChanged || newlyCreatedRemote) {
            const remoteText = await readRawFileText(existing);
            if (remoteText && remoteText.trim().length > 2) {
              const diskWriteId = extractWriteId(remoteText);
              const sameWrite = Boolean(diskWriteId && knownWriteId && diskWriteId === knownWriteId);
              if (!sameWrite) {
                if (S.activeProjectId === targetProjectId) {
                  S.conflictRemoteText = remoteText;
                  S.conflictRemoteModified = existingMod || Date.now();
                  S.conflictRemoteDoc = null;
                  try {
                    S.conflictRemoteDoc = (await D().decodePbsFromText(remoteText, project, undefined, getUserName(), { silentPrompt: true })).doc;
                  } catch (_e) {}
                  setSyncStatus('Conflict detected \u2014 auto-save paused', 'warn');
                  S.hooks.rerender();
                }
                return false;
              }
            }
          }
        }
      }

      const fh = await getFileHandleForName(targetFileName, true);
      if (!fh) return false;

      docClone.meta = docClone.meta || {};
      docClone.meta.revision = (Number(docClone.meta.revision) || 0) + 1;
      docClone.meta.lastModifiedAt = new Date().toISOString();
      docClone.meta.lastModifiedBy = getUserName();
      const writeId = D().makeId('w');
      docClone.meta.lastWriteId = writeId;

      const { text, encrypted } = await D().encodePbsForDisk(docClone, requireEnc);
      const writable = await withPbsTimeout(fh.createWritable(), IO_TIMEOUT_MS);
      await writable.write(text);
      await writable.close();

      let postModified = Date.now();
      try {
        const postFile = await fh.getFile();
        if (postFile && postFile.lastModified) postModified = Number(postFile.lastModified);
      } catch (_e) {}

      getCache()[targetProjectId] = docClone;
      persistCache();
      S.dirtyProjectIds.delete(targetProjectId);
      S.folderFileMtimes.set(targetProjectId, postModified);

      if (S.activeProjectId === targetProjectId) {
        if (S.activeDoc) S.activeDoc.meta = { ...docClone.meta };
        S.activeFileModified = postModified;
        S.lastWrittenId = writeId;
        if (encrypted) S.activeWasEncrypted = true;
        S.conflictRemoteText = null; S.conflictRemoteDoc = null; S.conflictRemoteModified = 0;
        setSyncStatus(`${encrypted ? 'Encrypted & synced' : 'Synced'} (${targetFileName})`, 'ok');
      }
      S.hooks.onBadges();
      return true;
    } catch (err) {
      if (err && err.code === 'PASSPHRASE_LOCKED') {
        setSyncStatus('Passphrase locked \u2014 unlock to save encrypted PBS', 'warn');
        toast(err.message, 'warning');
        if (!isSessionLocked() && typeof openSyncEncryptionDialog === 'function') {
          openSyncEncryptionDialog('Unlock your session passphrase to resume encrypted PBS auto-save.');
        }
      } else if (isPbsConnectionError(err)) {
        handlePbsFolderDisconnected(err);
      } else {
        setSyncStatus((err && err.message) || 'Auto-save failed', 'error');
        toast((err && err.message) || 'Failed to save PBS file.', 'error');
      }
      return false;
    } finally {
      S.isSaving = false;
      if (S.saveQueued && S.dirHandle && S.activeProjectId && (!isSessionLocked() || S.isFlushingForLock)) {
        S.saveQueued = false;
        setTimeout(() => { writeToFolder(false); }, 150);
      }
    }
  }

  /* Call after every local edit: caches immediately, debounces the folder write. */
  function scheduleSave() {
    if (!S.activeProjectId || !S.activeDoc || isSessionLocked()) return;
    S.dirtyProjectIds.add(S.activeProjectId);
    getCache()[S.activeProjectId] = S.activeDoc;
    persistCache();
    S.hooks.onBadges();
    if (!S.dirHandle) { setSyncStatus('Saved locally in browser', 'idle'); return; }
    setSyncStatus('Saving...', 'idle');
    if (S.saveTimer) clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(() => {
      S.saveTimer = null;
      writeToFolder(false);
    }, SAVE_DEBOUNCE_MS);
  }

  async function pollOnce() {
    if (!S.dirHandle || isSessionLocked()) return;
    const dialogOpen = Boolean(S.hooks.isDialogOpen() && S.activeProjectId);
    if (!dialogOpen) {
      await scanFolderForBadges({ force: false });
      return;
    }
    if (S.isSaving || S.saveTimer || S.saveQueued || S.conflictRemoteText) return;
    try {
      const fh = await getFileHandle(false);
      if (fh) {
        const file = await withPbsTimeout(fh.getFile(), IO_TIMEOUT_MS);
        const fileMod = Number(file.lastModified || 0);
        const changed = (S.activeFileModified > 0 && fileMod > S.activeFileModified + 500)
          || (S.activeFileModified === 0 && fileMod > 0);
        if (changed) {
          const rawText = await readRawFileText(file);
          const diskWriteId = extractWriteId(rawText);
          if (diskWriteId && S.lastWrittenId && diskWriteId === S.lastWrittenId) {
            S.activeFileModified = Math.max(S.activeFileModified, fileMod);
            S.folderFileMtimes.set(S.activeProjectId, S.activeFileModified);
          } else if (S.dirtyProjectIds.has(S.activeProjectId)) {
            // Local unsaved edits exist -> surface conflict rather than overwriting local edits!
            S.conflictRemoteText = rawText;
            S.conflictRemoteModified = fileMod;
            S.conflictRemoteDoc = null;
            try {
              S.conflictRemoteDoc = (await D().decodePbsFromText(rawText, getProject(S.activeProjectId), undefined, getUserName(), { silentPrompt: true })).doc;
            } catch (_e) {}
            setSyncStatus('Conflict detected \u2014 auto-save paused', 'warn');
            S.hooks.rerender();
            return;
          } else if (await syncFromFolder({ silentMissing: true, silentErrors: true })) {
            toast('PBS updated from shared folder.', 'info');
            S.hooks.rerender();
          }
        }
      }
      await scanFolderForBadges({ force: false, skipActive: true });
    } catch (err) {
      if (isPbsConnectionError(err) && err.name !== 'NotFoundError') {
        handlePbsFolderDisconnected(err);
      }
    }
  }

  async function pollFolderBackground(opts = {}) {
    if (isSessionLocked()) return false;
    const force = Boolean(opts && opts.force);
    const allowPrompt = Boolean(opts && opts.allowPrompt);
    const minIntervalMs = Number(opts && opts.minIntervalMs) || 0;
    if (!force && minIntervalMs > 0 && (Date.now() - S.lastBackgroundPollAt) < minIntervalMs && S.dirHandle) {
      return true;
    }
    if (!S.dirHandle) {
      return tryAutoReconnectFolder({ allowPrompt, force });
    }
    if (!S.pollTimer) startPolling();
    if (force) {
      if (S.hooks.isDialogOpen() && S.activeProjectId) {
        await pollOnce();
      }
      const updated = await scanFolderForBadges({ force: true, skipActive: Boolean(S.hooks.isDialogOpen() && S.activeProjectId) });
      if (opts && opts.notify) {
        toast(updated > 0 ? `Synced ${updated} PBS file${updated === 1 ? '' : 's'} from "${S.dirHandle.name}".` : `All PBS files in "${S.dirHandle.name}" are up to date.`, 'success');
      }
      return true;
    }
    await pollOnce();
    return true;
  }

  function startPolling() { stopPolling(); if (S.dirHandle && !isSessionLocked()) S.pollTimer = setInterval(pollOnce, POLL_MS); }
  function stopPolling() { if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; } }

  /* ---------- Lock, Logout, Password Rotation & Project Rename Lifecycle ---------- */
  async function flushBeforeLock() {
    const waitStart = Date.now();
    while (S.isSaving && Date.now() - waitStart < 4500) {
      await new Promise(r => setTimeout(r, 60));
    }
    if (S.saveTimer) {
      clearTimeout(S.saveTimer);
      S.saveTimer = null;
      if (S.dirHandle && S.activeProjectId && S.activeDoc && !S.conflictRemoteText) {
        S.isFlushingForLock = true;
        try { await writeToFolder(false); } finally { S.isFlushingForLock = false; }
      }
    } else if ((S.saveQueued || S.syncStatusText === 'Saving...' || S.dirtyProjectIds.has(S.activeProjectId)) && S.dirHandle && S.activeProjectId && S.activeDoc && !S.conflictRemoteText) {
      S.saveQueued = false;
      S.isFlushingForLock = true;
      try { await writeToFolder(false); } finally { S.isFlushingForLock = false; }
    }
  }

  function clearMemoryAndStopSync() {
    stopPolling();
    if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; }
    S.saveQueued = false;
    S.isFlushingForLock = false;
    S.dirHandle = null;
    S.activeProjectId = '';
    S.activeDoc = null;
    S.activeFileModified = 0;
    S.lastWrittenId = '';
    S.conflictRemoteText = null;
    S.conflictRemoteDoc = null;
    S.conflictRemoteModified = 0;
    S.cache = {};
    S.dirtyProjectIds.clear();
    S.folderFileMtimes.clear();
    S.lastBackgroundPollAt = 0;
    try {
      const k = D().CACHE_KEY;
      if (typeof safeRemoveStorage === 'function') safeRemoveStorage(k);
      else if (typeof localStorage !== 'undefined') localStorage.removeItem(k);
    } catch (_e) {}
  }

  async function reencryptAllPbsFilesInFolder(oldPass, newPass) {
    const mainMeta = getLiveDbRef()?.settings?.pbsFolder || {};
    if (!oldPass || !newPass || typeof decryptPulsePlanData !== 'function' || typeof encryptPulsePlanData !== 'function') {
      return { attempted: false, rotatedCount: 0, failedFiles: [], needsAttention: Boolean(mainMeta.enabled) };
    }
    let dir = S.dirHandle;
    if (!dir && supportsDirSync()) {
      const rem = S.rememberedDirHandle || await loadRememberedDirHandle();
      if (rem && await ensureDirPermission(rem, false)) {
        dir = rem;
        S.dirHandle = rem;
      }
    }
    if (!dir || typeof dir.values !== 'function') {
      return { attempted: false, rotatedCount: 0, failedFiles: [], needsAttention: Boolean(mainMeta.enabled) };
    }
    let rotatedCount = 0;
    const failedFiles = [];
    const fmt = encFormat();
    try {
      for await (const entry of dir.values()) {
        if (!entry || entry.kind !== 'file' || !/^pbs_.*\.json$/i.test(entry.name)) continue;
        try {
          const file = await withPbsTimeout(entry.getFile(), IO_TIMEOUT_MS);
          const rawText = await readRawFileText(file);
          let parsed = null;
          try { parsed = JSON.parse(rawText); } catch (_e) { continue; }
          if (!parsed || parsed.format !== fmt) continue;
          const plain = await decryptPulsePlanData(parsed, oldPass);
          const plainObj = typeof plain === 'string' ? JSON.parse(plain) : plain;
          const newEnv = await encryptPulsePlanData(plainObj, newPass);
          const outEnv = { ...newEnv, type: 'pulseplan-pbs' };
          if (parsed.writeId) outEnv.writeId = parsed.writeId;
          const writable = await withPbsTimeout(entry.createWritable(), IO_TIMEOUT_MS);
          await writable.write(JSON.stringify(outEnv, null, 2));
          await writable.close();
          rotatedCount++;
        } catch (_fileErr) {
          failedFiles.push(entry.name);
        }
      }
    } catch (_iterErr) {
      return { attempted: true, rotatedCount, failedFiles: [...failedFiles, '(folder read error)'], needsAttention: true };
    }
    return { attempted: true, rotatedCount, failedFiles, needsAttention: failedFiles.length > 0 };
  }

  async function onProjectCodeRenamed(projectId, prevCode, nextCode) {
    if (!projectId || !prevCode || !nextCode || prevCode === nextCode) return;
    const cache = getCache();
    const prevName = D().getPbsFilename({ id: projectId, code: prevCode }, projectId);
    const nextName = D().getPbsFilename({ id: projectId, code: nextCode }, projectId);
    if (prevName === nextName) return;

    let docToCarry = cache[projectId] || null;
    if (S.dirHandle) {
      try {
        const oldFh = await getFileHandleForName(prevName, false);
        const newFhCheck = await getFileHandleForName(nextName, false);
        if (oldFh && !newFhCheck) {
          const file = await withPbsTimeout(oldFh.getFile(), IO_TIMEOUT_MS);
          const rawText = await readRawFileText(file);
          const proj = getProject(projectId);
          const { doc, wasEncrypted } = await D().decodePbsFromText(rawText, proj, undefined, getUserName(), { silentPrompt: true });
          doc.projectCode = nextCode;
          docToCarry = doc;
          const newFh = await getFileHandleForName(nextName, true);
          const { text } = await D().encodePbsForDisk(doc, wasEncrypted || Boolean(getSessionPassphrase()));
          const w = await newFh.createWritable();
          await w.write(text);
          await w.close();
        }
      } catch (_e) {}
    }
    if (docToCarry) {
      docToCarry.projectCode = nextCode;
      cache[projectId] = docToCarry;
      persistCache();
      S.hooks.onBadges();
    }
  }

  /* ---------- Misc helpers for the UI ---------- */
  function getFolderSyncSummary() {
    const dbMeta = getLiveDbRef()?.settings?.pbsFolder || null;
    return {
      supported: supportsDirSync(),
      connected: Boolean(S.dirHandle),
      folderName: S.dirHandle ? String(S.dirHandle.name || '') : '',
      rememberedName: (!S.dirHandle && S.rememberedDirHandle) ? String(S.rememberedDirHandle.name || '') : '',
      dbFolderName: (dbMeta && dbMeta.enabled && dbMeta.folderName) ? String(dbMeta.folderName) : '',
    };
  }
  function getItemCount(projectId) {
    const doc = getCache()[projectId];
    return doc && Array.isArray(doc.items) ? doc.items.length : 0;
  }
  function listCloneSources() {
    const cache = getCache();
    return (getDb().projects || []).filter(p => p.id !== S.activeProjectId && cache[p.id] && Array.isArray(cache[p.id].items) && cache[p.id].items.length > 0);
  }
  function downloadText(filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  P.core = {
    state: S, getDb, getProject, getUserName, toast, getCache, supportsDirSync, getSessionPassphrase,
    setSyncStatus, logChange, getOwnerSuggestions, getManufacturerSuggestions, getProcStatusSuggestions,
    openSession, initFolder, tryAutoReconnectFolder, scanFolderForBadges, pollFolderBackground, getFolderSyncSummary,
    replaceDoc, linkFolder, reconnectFolder, syncFromFolder, writeToFolder, scheduleSave, pollOnce, startPolling, stopPolling,
    flushBeforeLock, clearMemoryAndStopSync, reencryptAllPbsFilesInFolder, onProjectCodeRenamed,
    getItemCount, listCloneSources, downloadText, fileNameFor,
  };
})();
