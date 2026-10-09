/** Reviewed native-source variant. Observation only; does not approve or change producer behavior. */
var SAHMT_MIGRATION_NATIVE_INVENTORY_REVIEW_ = Object.freeze({
 schemaVersion:1, scope:'APPS_SCRIPT_CURRENT_PROJECT_ONLY',
 scriptProjectSha256:'24ab76de1c5bd8e1119733600318b45fd445f27d5cbccc97bcf326ce5afffe01', sourceBasisSha256:'1e7733e53ed29035cd149ece8d453aefd6b0a7db70a7a51eee58dc3bef457bc3',
 evidencePlaintextSha256:'5938deeae36b5c3689b32913a810b537ef0f860c5e9250e156c30a2af227b51b', reviewedModules:["ChecklistProjection.gs","ChecklistValidation.gs","Config.gs","EvaluationLedger.gs","FormsEvaluation.gs","ManagementScoreValidation.gs","Preflight.gs","ReportsSetup.gs","ScheduleSourceSync.gs","SparkReportSync.gs","TrainingRelease.gs","TrainingValidation.gs"],
 functions:[
  {name:'applyEvaluationAwardDesired_',sha256:'3febf13991022257e0b4e70c3eb92cda75280229f12fa0ebaf03ce6cac7fc453',read:function(){return typeof applyEvaluationAwardDesired_==='function'?applyEvaluationAwardDesired_:null;}},
  {name:'applyReportColumnFormats_',sha256:'b74fb84778291ca27743a789a936861b7e8fbea9e254f79123ce9b695ab06303',read:function(){return typeof applyReportColumnFormats_==='function'?applyReportColumnFormats_:null;}},
  {name:'buildScheduleSourcePlan_',sha256:'2203c11fec65dba62fb9b97e754c3716730a4af15cd5345fae5612cef17d280d',read:function(){return typeof buildScheduleSourcePlan_==='function'?buildScheduleSourcePlan_:null;}},
  {name:'capturarHomologacaoAvaliacaoSahmtV2',sha256:'48d06069a95b0186c6442ae371e9cd6841c3b91502f98628bfff9d775e949bef',read:function(){return typeof capturarHomologacaoAvaliacaoSahmtV2==='function'?capturarHomologacaoAvaliacaoSahmtV2:null;}},
  {name:'checklistRequestUpdateWrite_',sha256:'a5e32adfff3cc819fb8e3a158dce735d3c9b3f6367231d5520fd7aa1926dce00',read:function(){return typeof checklistRequestUpdateWrite_==='function'?checklistRequestUpdateWrite_:null;}},
  {name:'checklistResponsibilityProjectionWrite_',sha256:'317702b8cb1ae221edfe23d944c47f88ac7fbcc953974f53ea96278e3efce37c',read:function(){return typeof checklistResponsibilityProjectionWrite_==='function'?checklistResponsibilityProjectionWrite_:null;}},
  {name:'checklistSaoPauloDay_',sha256:'89f3b1b44979938e0f3c11f2912f88a8eb2081f8d3ed3d5c11da0e7b6ea9ad25',read:function(){return typeof checklistSaoPauloDay_==='function'?checklistSaoPauloDay_:null;}},
  {name:'checklistSiglas_',sha256:'9b713b33c55b3a5bae935d754af0133dd55f392876d0e1404dfc01bc51e056c8',read:function(){return typeof checklistSiglas_==='function'?checklistSiglas_:null;}},
  {name:'checklistStoredSnapshotRevision_',sha256:'fb1279e57cc9dbff3d16287a82f2fe5ae5a5b0a5cc4a6b6ab2f803dd1f1d527a',read:function(){return typeof checklistStoredSnapshotRevision_==='function'?checklistStoredSnapshotRevision_:null;}},
  {name:'checklistWeekday_',sha256:'8d8ab51ecba725d9a613202e2a9f08d353f125eefab733742417e90ff12d540c',read:function(){return typeof checklistWeekday_==='function'?checklistWeekday_:null;}},
  {name:'compareScheduleSourceWithFirestore_',sha256:'a163153204165c70ed1619a6dfefa9761264bbafa434e226cc5370a3c43851a3',read:function(){return typeof compareScheduleSourceWithFirestore_==='function'?compareScheduleSourceWithFirestore_:null;}},
  {name:'configurarModeloAvaliacaoSahmtV2',sha256:'64b2cc3d151e7f597dae68136862f7c37bfb32c665bcbb0587c050bc2b2e6d98',read:function(){return typeof configurarModeloAvaliacaoSahmtV2==='function'?configurarModeloAvaliacaoSahmtV2:null;}},
  {name:'consultarAcessoMateriaisTreinamentosSahmtV2',sha256:'50620e6509c9aa9311962f9d609dac27a78bbc845e52140f07202f65eabedee9',read:function(){return typeof consultarAcessoMateriaisTreinamentosSahmtV2==='function'?consultarAcessoMateriaisTreinamentosSahmtV2:null;}},
  {name:'consultarCatalogoTreinamentosSahmtV2',sha256:'6ca9a79f4251070041aa2470dc322e938dd052e15d3dfae2815b30fc99e60f2a',read:function(){return typeof consultarCatalogoTreinamentosSahmtV2==='function'?consultarCatalogoTreinamentosSahmtV2:null;}},
  {name:'consultarDisponibilizacaoTreinamentosSahmtV2',sha256:'74b10ace8d37633a0ebfc157144d0af9c4789a12b0c14ac55d5d4aca97b73c38',read:function(){return typeof consultarDisponibilizacaoTreinamentosSahmtV2==='function'?consultarDisponibilizacaoTreinamentosSahmtV2:null;}},
  {name:'consultarPadraoFormulariosSahmtV2',sha256:'220664abd3f61c0bc244661071a31d6a37bf27e30048a5f80d3bec75ca1169b7',read:function(){return typeof consultarPadraoFormulariosSahmtV2==='function'?consultarPadraoFormulariosSahmtV2:null;}},
  {name:'continuarDisponibilizacaoTreinamentosSahmtV2_',sha256:'a8cdd2348309571797c8fee9a875c61cec6707fb8f9ff0f1fda69ebc17de5b8c',read:function(){return typeof continuarDisponibilizacaoTreinamentosSahmtV2_==='function'?continuarDisponibilizacaoTreinamentosSahmtV2_:null;}},
  {name:'evaluationActiveProfile_',sha256:'5241bc2195136d7168d388086e8d31d992d3e43a582aa51bbfdffd83d2a7a055',read:function(){return typeof evaluationActiveProfile_==='function'?evaluationActiveProfile_:null;}},
  {name:'evaluationAdmin_',sha256:'fd76f11517760ea6c7237b6de80a08dea372ec4bd8a6b064c6061350dd612690',read:function(){return typeof evaluationAdmin_==='function'?evaluationAdmin_:null;}},
  {name:'evaluationApplyAwards_',sha256:'1c0c579db47572cbd1b32c279a572ef72ab6caa44db3c9014a9e2cddd7ad5d72',read:function(){return typeof evaluationApplyAwards_==='function'?evaluationApplyAwards_:null;}},
  {name:'evaluationApplyChecklistTransfer_',sha256:'a2ffac30a159d607a0ae1b80fa5ac68efdf72fa63d6b1b213aa232aa5bee1237',read:function(){return typeof evaluationApplyChecklistTransfer_==='function'?evaluationApplyChecklistTransfer_:null;}},
  {name:'evaluationAssertOperator_',sha256:'b276ebdfd1dcf8d3e1c5bebaa25bc0ce50eb1764e2d93cf9a6428f86a52019fa',read:function(){return typeof evaluationAssertOperator_==='function'?evaluationAssertOperator_:null;}},
  {name:'evaluationAwardId_',sha256:'da2238598bd1addbfa9b3f31c8aab4ec5f4e752be45253e24ccd478a07ec3a75',read:function(){return typeof evaluationAwardId_==='function'?evaluationAwardId_:null;}},
  {name:'evaluationCategoryFields_',sha256:'05010e07776cf5619260c9a455f0b1bd16d804c66f3f4d1632a4085c1a945daf',read:function(){return typeof evaluationCategoryFields_==='function'?evaluationCategoryFields_:null;}},
  {name:'evaluationClean_',sha256:'f4a674d0582d21daadb118a237ae5198a372d35d9b6beb015269b8c60b656c94',read:function(){return typeof evaluationClean_==='function'?evaluationClean_:null;}},
  {name:'evaluationCorrectChecklistSignature_',sha256:'dbb7f9eb20ca7819748e7ab3606d36268fc9d6f7a45f32c69565d678eb586221',read:function(){return typeof evaluationCorrectChecklistSignature_==='function'?evaluationCorrectChecklistSignature_:null;}},
  {name:'evaluationDocument_',sha256:'0e3646ac9611d9b80d9842c1fec141380ce2a96e2d2fde33f696785726be481a',read:function(){return typeof evaluationDocument_==='function'?evaluationDocument_:null;}},
  {name:'evaluationGet_',sha256:'f1866a208d50f9936e32c7f9809241b767c51d690f5aa9b708dbeffb5f795432',read:function(){return typeof evaluationGet_==='function'?evaluationGet_:null;}},
  {name:'evaluationPlanAward_',sha256:'651f8736b4103b02f0a6b77e8dc84a276d7f88863f01012711712d7020560232',read:function(){return typeof evaluationPlanAward_==='function'?evaluationPlanAward_:null;}},
  {name:'evaluationPlanChecklistTransfer_',sha256:'1ff7b5b28f1aaefa7cff2e0048013f7c1b6653f2dd9471f758ce0f5a112cd95c',read:function(){return typeof evaluationPlanChecklistTransfer_==='function'?evaluationPlanChecklistTransfer_:null;}},
  {name:'evaluationProcessScoreCorrection_',sha256:'95f9b1d244dac96eb7f4010550a729848ba060cc86e0707f4c9d29f1cb6c83ac',read:function(){return typeof evaluationProcessScoreCorrection_==='function'?evaluationProcessScoreCorrection_:null;}},
  {name:'evaluationPublishCategorySummary_',sha256:'af35015311c189eced74fcb40ecdbdb172d876affae913efa5c2350f7a2baeaa',read:function(){return typeof evaluationPublishCategorySummary_==='function'?evaluationPublishCategorySummary_:null;}},
  {name:'evaluationQuery_',sha256:'c0e1b2f71f0c891debb5409ba51ce167ef106ace4d3250c816967bfeb124f08b',read:function(){return typeof evaluationQuery_==='function'?evaluationQuery_:null;}},
  {name:'evaluationRunTransaction_',sha256:'ca5b575b7ad707587855055846b17b12691cca046b2f47c6ff2e8e020f9a6531',read:function(){return typeof evaluationRunTransaction_==='function'?evaluationRunTransaction_:null;}},
  {name:'evaluationSummarizeCategory_',sha256:'53dc47846ae9d6416cea54205c8cd99f6b050db8769d90c64bdbf0d0dc30dad5',read:function(){return typeof evaluationSummarizeCategory_==='function'?evaluationSummarizeCategory_:null;}},
  {name:'evaluationValidPoints_',sha256:'09810fc1c914e347bcf379d4835634756a33b1ef3bef7cd6f0ace6a0d98acb8c',read:function(){return typeof evaluationValidPoints_==='function'?evaluationValidPoints_:null;}},
  {name:'evaluationWrite_',sha256:'bc11f0b71d6c74e05fafc098fefde7bc1728c4af5bdb1dd22623ce0ac8e0a27f',read:function(){return typeof evaluationWrite_==='function'?evaluationWrite_:null;}},
  {name:'eventMemberSiglas_',sha256:'2705474a94ac303469f71bc12181b07a65ba2ecfd20279a4ff50f5434b358a9a',read:function(){return typeof eventMemberSiglas_==='function'?eventMemberSiglas_:null;}},
  {name:'findHeaderRow_',sha256:'a05a0b22fecc74c5dc5a333ae266b7b5fbf9c00eac4b7f51fad7736e0e5e7cf5',read:function(){return typeof findHeaderRow_==='function'?findHeaderRow_:null;}},
  {name:'firestoreDocumentName_',sha256:'b03d8ab550abb6ea63608518b7b571c06496f698c425ce44462e401c61af1272',read:function(){return typeof firestoreDocumentName_==='function'?firestoreDocumentName_:null;}},
  {name:'firestoreDocumentsUrl_',sha256:'9987d74e979312b445cc48252eb3a1c065b49a7d939f7c679ea67c15c752927e',read:function(){return typeof firestoreDocumentsUrl_==='function'?firestoreDocumentsUrl_:null;}},
  {name:'firestoreFieldsFromJs_',sha256:'45b280b828e439ec222848fb72a0a9327a2edd78f410df85076dbf896c8e1dd0',read:function(){return typeof firestoreFieldsFromJs_==='function'?firestoreFieldsFromJs_:null;}},
  {name:'firestoreFieldsToJs_',sha256:'3f2d96700f15a1615bd392d7e0d84f259e75bb9fede2c18f0cc90388e05748fa',read:function(){return typeof firestoreFieldsToJs_==='function'?firestoreFieldsToJs_:null;}},
  {name:'firestoreFilter_',sha256:'98ae33e486b28182717e0b1492ad4bf84cf1209f8fbabca115e9d68cffc764ef',read:function(){return typeof firestoreFilter_==='function'?firestoreFilter_:null;}},
  {name:'firestoreRequest_',sha256:'8f7d912079b5f988919ab301d25f0f4b37e2240124476ea0c17b86ecea3bd9d4',read:function(){return typeof firestoreRequest_==='function'?firestoreRequest_:null;}},
  {name:'firestoreValueFromJs_',sha256:'9b19ce85c9bddd08995a7eb184fd77e2f190233ba1aa3c570a3f40d3fa48e3e2',read:function(){return typeof firestoreValueFromJs_==='function'?firestoreValueFromJs_:null;}},
  {name:'firestoreValueToJs_',sha256:'270dccecb5526888ea585f046f361ec9267349f9dad3d387152a137d760abcdc',read:function(){return typeof firestoreValueToJs_==='function'?firestoreValueToJs_:null;}},
  {name:'formsEvaluationActive_',sha256:'697bcbdea9b28f6638d193789382981ec11554dd3962720a9793a2d89b1075f8',read:function(){return typeof formsEvaluationActive_==='function'?formsEvaluationActive_:null;}},
  {name:'formsEvaluationAdmin_',sha256:'e8b849bd3b0a9c33d17535b463bafc56a510a4027642b07f3509ee8b59c2dbb2',read:function(){return typeof formsEvaluationAdmin_==='function'?formsEvaluationAdmin_:null;}},
  {name:'formsEvaluationAll_',sha256:'4529908527a0731f9e1d3e3afb3037614745bed3ebcbe5b7b6d9a8d62ca4045c',read:function(){return typeof formsEvaluationAll_==='function'?formsEvaluationAll_:null;}},
  {name:'formsEvaluationAnswer_',sha256:'1ee6b5b5dc26e2c8bf2b2437f9db01f025ad3b2b2a0499ab24fa42882cb4f432',read:function(){return typeof formsEvaluationAnswer_==='function'?formsEvaluationAnswer_:null;}},
  {name:'formsEvaluationAssignments_',sha256:'b75910a5eb552aa4348370400644024856cbd30daa65941fbfa18f20f7f5c4f7',read:function(){return typeof formsEvaluationAssignments_==='function'?formsEvaluationAssignments_:null;}},
  {name:'formsEvaluationCheckedMapping_',sha256:'d69aa1d60699d78d6085c06174fc309bda13148682c81a34d87a8710c14cc4d7',read:function(){return typeof formsEvaluationCheckedMapping_==='function'?formsEvaluationCheckedMapping_:null;}},
  {name:'formsEvaluationCloseForm_',sha256:'61a0c418bc6d5e053dc0e5ce188040d466c53cfbaa2ed73137a597ed341953ec',read:function(){return typeof formsEvaluationCloseForm_==='function'?formsEvaluationCloseForm_:null;}},
  {name:'formsEvaluationCommitWrites_',sha256:'af1f329c758f817820b5b02d11dcfddc11ec7cc0dd44ff3417432d8408dfc707',read:function(){return typeof formsEvaluationCommitWrites_==='function'?formsEvaluationCommitWrites_:null;}},
  {name:'formsEvaluationComponentDuplicates_',sha256:'3b0643454a4e77a21ee5fc1e60144e6b882b6ad2141fe0574f76387724ed6ec3',read:function(){return typeof formsEvaluationComponentDuplicates_==='function'?formsEvaluationComponentDuplicates_:null;}},
  {name:'formsEvaluationConfiguration_',sha256:'8d02ba5db32180fd9f3690bea51c5f4fd98ae53175321b985999ab49d93c90e8',read:function(){return typeof formsEvaluationConfiguration_==='function'?formsEvaluationConfiguration_:null;}},
  {name:'formsEvaluationConfigured_',sha256:'8f6e301dbb8368e5a55b9f90b43a31fc5ffec5cb488af51e21c8a77348139d55',read:function(){return typeof formsEvaluationConfigured_==='function'?formsEvaluationConfigured_:null;}},
  {name:'formsEvaluationContent_',sha256:'55c681b9fde8b6ed541b7306e05b725992f6084a6afec8731fd53321d18321e7',read:function(){return typeof formsEvaluationContent_==='function'?formsEvaluationContent_:null;}},
  {name:'formsEvaluationDriveDiscover_',sha256:'8c95aa4182b0329f460905662b82af86dd36dea84606e6b7b6dfcf9dfad66720',read:function(){return typeof formsEvaluationDriveDiscover_==='function'?formsEvaluationDriveDiscover_:null;}},
  {name:'formsEvaluationDriveReferences_',sha256:'51d71270c7340c85c933a8955c6a44d88f26a179d6e790f611bb5c8b3b5ee889',read:function(){return typeof formsEvaluationDriveReferences_==='function'?formsEvaluationDriveReferences_:null;}},
  {name:'formsEvaluationEligibleProfile_',sha256:'fd5c5934c4f6ac228e58db77ca50b1b36a97484a950484039bb2313a87ec52ff',read:function(){return typeof formsEvaluationEligibleProfile_==='function'?formsEvaluationEligibleProfile_:null;}},
  {name:'formsEvaluationExpectedOwners_',sha256:'22b0dd67b12c2831cd22ecf8f187efeba17ea3ef8918b0d74952b58ae6a3320e',read:function(){return typeof formsEvaluationExpectedOwners_==='function'?formsEvaluationExpectedOwners_:null;}},
  {name:'formsEvaluationExtractLinks_',sha256:'64bffbdbb02c1ae60152c0e86dd07c6b54abc8fd52b750ecc06fee1f00243397',read:function(){return typeof formsEvaluationExtractLinks_==='function'?formsEvaluationExtractLinks_:null;}},
  {name:'formsEvaluationFilterGroupRoster_',sha256:'10a56f33e7ea375fb7d3d9c36451c7b10e0b6dd8dce6195024c4124d83152ea8',read:function(){return typeof formsEvaluationFilterGroupRoster_==='function'?formsEvaluationFilterGroupRoster_:null;}},
  {name:'formsEvaluationFinalizePublication_',sha256:'df75abbae91238f540fa0f76b7b1451e55b7fe626d2dbea53c7b121171317714',read:function(){return typeof formsEvaluationFinalizePublication_==='function'?formsEvaluationFinalizePublication_:null;}},
  {name:'formsEvaluationFindQuestion_',sha256:'c90506d17ba8f26719809f4d1cec5ec7f28b3836031a1f3948ffd3c4fa46a63e',read:function(){return typeof formsEvaluationFindQuestion_==='function'?formsEvaluationFindQuestion_:null;}},
  {name:'formsEvaluationFormGovernance_',sha256:'478ee7984d794a775198dcc377d84c2aaff0fe8d0c67b2f6398148fcc1b28e58',read:function(){return typeof formsEvaluationFormGovernance_==='function'?formsEvaluationFormGovernance_:null;}},
  {name:'formsEvaluationGoogleError_',sha256:'c7d27fa46257cf2ddba2a0eb393842135197343495ddb66085047c0fa840afb7',read:function(){return typeof formsEvaluationGoogleError_==='function'?formsEvaluationGoogleError_:null;}},
  {name:'formsEvaluationGoogleRequest_',sha256:'1aa24e24318f8cf6ac7d187d51e9ed99d85450311449628566d036d5110839b9',read:function(){return typeof formsEvaluationGoogleRequest_==='function'?formsEvaluationGoogleRequest_:null;}},
  {name:'formsEvaluationGovernanceRequest_',sha256:'247dbfb0d1b950602f866ed348f427d0d12baf6d872903429aaea4b038d73bc6',read:function(){return typeof formsEvaluationGovernanceRequest_==='function'?formsEvaluationGovernanceRequest_:null;}},
  {name:'formsEvaluationGroupRoster_',sha256:'56c5ea20819a0e94099a5caf944e754697e5173bdd3a59993bfad0fd5af7f64d',read:function(){return typeof formsEvaluationGroupRoster_==='function'?formsEvaluationGroupRoster_:null;}},
  {name:'formsEvaluationHash_',sha256:'288248da65b352bf2065edbb736e74e1084a3e08ef0f0874393842ec716f6552',read:function(){return typeof formsEvaluationHash_==='function'?formsEvaluationHash_:null;}},
  {name:'formsEvaluationId_',sha256:'acc8bf178af103cedcadeccfd1ac3bb823bbd486b4bb040fa8d3f23a15f6ab5e',read:function(){return typeof formsEvaluationId_==='function'?formsEvaluationId_:null;}},
  {name:'formsEvaluationLink_',sha256:'79634fec2c190877748b0414bd42249d1d10ca1d2aec05d04fbed97836963979',read:function(){return typeof formsEvaluationLink_==='function'?formsEvaluationLink_:null;}},
  {name:'formsEvaluationMappedCriteria_',sha256:'c47ca8c5885d886d09ea67b11060c1ea1eba903a5a0dfe044a7dbe090f2d6e82',read:function(){return typeof formsEvaluationMappedCriteria_==='function'?formsEvaluationMappedCriteria_:null;}},
  {name:'formsEvaluationMappingPayload_',sha256:'754484a5e7dc5ec85649fbae8b7a932971f64dfefea10aac1c7a4ac1272a593a',read:function(){return typeof formsEvaluationMappingPayload_==='function'?formsEvaluationMappingPayload_:null;}},
  {name:'formsEvaluationMaterialFingerprint_',sha256:'21face2295e9499a5accbe758dd51d6d0436f5d7f741bc6e36730ae169559940',read:function(){return typeof formsEvaluationMaterialFingerprint_==='function'?formsEvaluationMaterialFingerprint_:null;}},
  {name:'formsEvaluationMaterialSnapshot_',sha256:'e5e9780855af6870918eca73c16baaa3ae619c372eead40f2addd8695981915e',read:function(){return typeof formsEvaluationMaterialSnapshot_==='function'?formsEvaluationMaterialSnapshot_:null;}},
  {name:'formsEvaluationMaterialSnapshotVerified_',sha256:'9614ecf4fad348155c1b4347245483d1451cf95477c9bf4ad521ecf56641fb42',read:function(){return typeof formsEvaluationMaterialSnapshotVerified_==='function'?formsEvaluationMaterialSnapshotVerified_:null;}},
  {name:'formsEvaluationMetadata_',sha256:'8715e948e10bc30ee4472bb2cdafe7c0368ac60ee752049dc893cd73477df812',read:function(){return typeof formsEvaluationMetadata_==='function'?formsEvaluationMetadata_:null;}},
  {name:'formsEvaluationNativeMaterialReason_',sha256:'83b0af10105294eb9843a7baeeca46fcb0fc0d8eea7e4a82a04fe5c759de8541',read:function(){return typeof formsEvaluationNativeMaterialReason_==='function'?formsEvaluationNativeMaterialReason_:null;}},
  {name:'formsEvaluationNativeReferences_',sha256:'6e4ebcec99a0f8d542447472e7ceaefd19a599ef74260c74751c0e1d46371125',read:function(){return typeof formsEvaluationNativeReferences_==='function'?formsEvaluationNativeReferences_:null;}},
  {name:'formsEvaluationParticipation_',sha256:'ce8f99aaf6bbc45146b8b8669fc8c51cac3743165cf15a9514f3047d0d995489',read:function(){return typeof formsEvaluationParticipation_==='function'?formsEvaluationParticipation_:null;}},
  {name:'formsEvaluationProcessRequest_',sha256:'897b34c662d4df86d9659d231a836358a453cdf17747fd77612c52cb09296c95',read:function(){return typeof formsEvaluationProcessRequest_==='function'?formsEvaluationProcessRequest_:null;}},
  {name:'formsEvaluationProcessResponse_',sha256:'8c06d399f06cad634fae9abeb62198fbc4a29a1b5801a7b8e48b7cb83c46cb9b',read:function(){return typeof formsEvaluationProcessResponse_==='function'?formsEvaluationProcessResponse_:null;}},
  {name:'formsEvaluationPublicationContext_',sha256:'4676ad6c10738a77cf21ac95d19c4ba2078bf5da5e99256122033ce061c6dec1',read:function(){return typeof formsEvaluationPublicationContext_==='function'?formsEvaluationPublicationContext_:null;}},
  {name:'formsEvaluationPublicationPending_',sha256:'daf21a453b292e9e5f8aac3fcd8a2e446a7f2ce4774b257983953c283dd8307c',read:function(){return typeof formsEvaluationPublicationPending_==='function'?formsEvaluationPublicationPending_:null;}},
  {name:'formsEvaluationPublishedPermissions_',sha256:'b969f45608b9f3dc1d54c770a248e1fe51fddcab0de90a2e19493b725b6be53e',read:function(){return typeof formsEvaluationPublishedPermissions_==='function'?formsEvaluationPublishedPermissions_:null;}},
  {name:'formsEvaluationPublishedPermissionsExact_',sha256:'74d7ff88b49ff7c9407c8d4a28a19af5a306a29af1942cf1e1676de812b18ac2',read:function(){return typeof formsEvaluationPublishedPermissionsExact_==='function'?formsEvaluationPublishedPermissionsExact_:null;}},
  {name:'formsEvaluationQuestionFingerprint_',sha256:'3146db03e9d165799d0e65a071b23adcde57b311efece0fea5c1860ef2282912',read:function(){return typeof formsEvaluationQuestionFingerprint_==='function'?formsEvaluationQuestionFingerprint_:null;}},
  {name:'formsEvaluationQuestionSnapshot_',sha256:'dc22c8a030987f5196ef222fc1857e64e145d57b14bb5b338d28c191e2b6cec4',read:function(){return typeof formsEvaluationQuestionSnapshot_==='function'?formsEvaluationQuestionSnapshot_:null;}},
  {name:'formsEvaluationReadDrive_',sha256:'c7ff74e376929c2d7d5bf06420be8709dfa5781f9d083ec2f7ce12b53b4de89b',read:function(){return typeof formsEvaluationReadDrive_==='function'?formsEvaluationReadDrive_:null;}},
  {name:'formsEvaluationReconcileLinks_',sha256:'430c6a28d44a228a218b47487a482a5b775aec9b9e5dc1cb60cda9fd0e2c870d',read:function(){return typeof formsEvaluationReconcileLinks_==='function'?formsEvaluationReconcileLinks_:null;}},
  {name:'formsEvaluationReleaseGate_',sha256:'b6c9fdf6526535f5f525a45cb28884974298a5c59518493ca26b709c2fd0ce48',read:function(){return typeof formsEvaluationReleaseGate_==='function'?formsEvaluationReleaseGate_:null;}},
  {name:'formsEvaluationReleaseGateUnchanged_',sha256:'b13389c0de4b092e0e52aecf8f2e78fa754ac22fa67b1f6946a5b6e6b779277b',read:function(){return typeof formsEvaluationReleaseGateUnchanged_==='function'?formsEvaluationReleaseGateUnchanged_:null;}},
  {name:'formsEvaluationResolve_',sha256:'eb6879bc7a1f85d4db2a45a7fc60f58f2f8946f2c05ff83c33e46693adb2cd49',read:function(){return typeof formsEvaluationResolve_==='function'?formsEvaluationResolve_:null;}},
  {name:'formsEvaluationResolveIdentity_',sha256:'5e08db64bf237a065b84bf654f0f4a9e06913daac1352a1618e7b7faf249f322',read:function(){return typeof formsEvaluationResolveIdentity_==='function'?formsEvaluationResolveIdentity_:null;}},
  {name:'formsEvaluationResponderEmails_',sha256:'20ef2d12d2904fe914bb02f74811a55f66a2f14f74dbbeb95172fd3ccae5dff5',read:function(){return typeof formsEvaluationResponderEmails_==='function'?formsEvaluationResponderEmails_:null;}},
  {name:'formsEvaluationReviewerAllowed_',sha256:'a2e5d9797b4a4defeef1f8a1077c6dc31056c954b8e96c3334ef2bf7667e6584',read:function(){return typeof formsEvaluationReviewerAllowed_==='function'?formsEvaluationReviewerAllowed_:null;}},
  {name:'formsEvaluationReviewGovernance_',sha256:'f1f8dab2bc41d001510275b9ace3372240c95b2027b9da01a9e948b2181c2842',read:function(){return typeof formsEvaluationReviewGovernance_==='function'?formsEvaluationReviewGovernance_:null;}},
  {name:'formsEvaluationReviewSuggestion_',sha256:'4a48ea8d40cce38bcdef65a1f7ae33a9468e49d93c542c567f37c22b2892e8a7',read:function(){return typeof formsEvaluationReviewSuggestion_==='function'?formsEvaluationReviewSuggestion_:null;}},
  {name:'formsEvaluationSavedQuestionFingerprint_',sha256:'71f1454ac4dee612ecf3df9bbf5f91298a944a20dc77d6d58b7e7444b09729d5',read:function(){return typeof formsEvaluationSavedQuestionFingerprint_==='function'?formsEvaluationSavedQuestionFingerprint_:null;}},
  {name:'formsEvaluationStable_',sha256:'3a61796b2f13b6a4e871e97a1418c6034f072fe7cd720404639c2859a75a4fc0',read:function(){return typeof formsEvaluationStable_==='function'?formsEvaluationStable_:null;}},
  {name:'formsEvaluationSyncResponders_',sha256:'7e1998f5c31b37d21125f5b24dd4a77084f5797451a51583a504f5aa7dfb0848',read:function(){return typeof formsEvaluationSyncResponders_==='function'?formsEvaluationSyncResponders_:null;}},
  {name:'formsEvaluationTemplateBatch_',sha256:'00ab05bef8cccdb8e981ab30de24333e044fc06189ab72d873f6003e4f7504ca',read:function(){return typeof formsEvaluationTemplateBatch_==='function'?formsEvaluationTemplateBatch_:null;}},
  {name:'formsEvaluationTemplateItem_',sha256:'55e2b071e87979de69e3285a4138c064b7dd75b904bb77f102b09061a478052f',read:function(){return typeof formsEvaluationTemplateItem_==='function'?formsEvaluationTemplateItem_:null;}},
  {name:'formsEvaluationTemplateMatches_',sha256:'bad71c8bde4689a65edbc76d1689f268197e6bbcaf9d51984077607e1220ece2',read:function(){return typeof formsEvaluationTemplateMatches_==='function'?formsEvaluationTemplateMatches_:null;}},
  {name:'formsEvaluationTemplateOriginalItems_',sha256:'821285304f98090dbcd1d13f20b98a0176a8268bb74350ad84fe71504e858282',read:function(){return typeof formsEvaluationTemplateOriginalItems_==='function'?formsEvaluationTemplateOriginalItems_:null;}},
  {name:'formsEvaluationTemplateSpecs_',sha256:'d6ed9a19e7a971d0eb1340d57b5c07fce6edf1992eb6d32e94468015c6a137aa',read:function(){return typeof formsEvaluationTemplateSpecs_==='function'?formsEvaluationTemplateSpecs_:null;}},
  {name:'formsEvaluationVerifyTemplate_',sha256:'5fcd321aa0feda6bd91f823d09db2c5efd1337af8ea97ffc9f6ef00761821f55',read:function(){return typeof formsEvaluationVerifyTemplate_==='function'?formsEvaluationVerifyTemplate_:null;}},
  {name:'formsEvaluationWriteRecord_',sha256:'c59a0049d5aa6525e37ca05f8830d3c327e2df6bd9bbdf6dce3c01a2828552a3',read:function(){return typeof formsEvaluationWriteRecord_==='function'?formsEvaluationWriteRecord_:null;}},
  {name:'formsPresentationPrivateArtifact_',sha256:'79b0994109d73581f6cf40ef6f5724666a0eed30742aa2f10143212be6e13c69',read:function(){return typeof formsPresentationPrivateArtifact_==='function'?formsPresentationPrivateArtifact_:null;}},
  {name:'formsPresentationSafeError_',sha256:'79b3eb6e58aa776f05e1be5e867d29404773c808ebf9ca0231abfd3d49db6853',read:function(){return typeof formsPresentationSafeError_==='function'?formsPresentationSafeError_:null;}},
  {name:'formsPresentationStableModel_',sha256:'c32563be638af6b1fd9bb567e69d261f56edc95547e19b4d50cdeb47d2e60d0d',read:function(){return typeof formsPresentationStableModel_==='function'?formsPresentationStableModel_:null;}},
  {name:'getFirestoreDocument_',sha256:'029dba4a3cf65e35901db57582b5af7143dfc78e676cac08d2e8c87456e65f3a',read:function(){return typeof getFirestoreDocument_==='function'?getFirestoreDocument_:null;}},
  {name:'hasChecklistSignPermission_',sha256:'7c1d103b8de2417b04f7a9ba9b66c73cc6a4aca467d9648b55a56085223cf9a5',read:function(){return typeof hasChecklistSignPermission_==='function'?hasChecklistSignPermission_:null;}},
  {name:'iniciarDisponibilizacaoTreinamentosSahmtV2',sha256:'5f4fff3bfee28d42be8765237f0bfdd3acfe6311c02338d0c54fc514b995014b',read:function(){return typeof iniciarDisponibilizacaoTreinamentosSahmtV2==='function'?iniciarDisponibilizacaoTreinamentosSahmtV2:null;}},
  {name:'initializeEvaluationCategoryState_',sha256:'aaccb46028db4a596714e22239e11ea6e68b63c62d340825fbac5bf263c1aaf5',read:function(){return typeof initializeEvaluationCategoryState_==='function'?initializeEvaluationCategoryState_:null;}},
  {name:'installChecklistResponsibilityTrigger',sha256:'762d581c3ba0a8ef90ef0352f1a17b020a15701e720950c25004d87224916180',read:function(){return typeof installChecklistResponsibilityTrigger==='function'?installChecklistResponsibilityTrigger:null;}},
  {name:'installChecklistValidationTrigger',sha256:'2424eac97e20c99fc2c73bc9f98f4ee7061aff73b044a67c897d149965d02446',read:function(){return typeof installChecklistValidationTrigger==='function'?installChecklistValidationTrigger:null;}},
  {name:'installEvaluationTriggers',sha256:'10f75e0d665518b37cb18ba2fe14e709623af3dfd3fb27d0be58bfb2fc819b40',read:function(){return typeof installEvaluationTriggers==='function'?installEvaluationTriggers:null;}},
  {name:'installManagementScoreValidationTrigger',sha256:'bbd4c87a3231488555ff8a23ce38425c2bf2fb6c1010bf458a1ebdb80b4e7634',read:function(){return typeof installManagementScoreValidationTrigger==='function'?installManagementScoreValidationTrigger:null;}},
  {name:'installSahmtV2SparkReportTrigger',sha256:'edfe0090b2e11cb6c0872123872984b687505d30536290e307d4137ec0941abc',read:function(){return typeof installSahmtV2SparkReportTrigger==='function'?installSahmtV2SparkReportTrigger:null;}},
  {name:'installTrainingValidationTrigger',sha256:'13cf8a93c4ccabcfd74e7f325921b80971de2cb45b76c60fe7aedeaa1b5d7917',read:function(){return typeof installTrainingValidationTrigger==='function'?installTrainingValidationTrigger:null;}},
  {name:'liberarCatalogoTreinamentosSahmtV2',sha256:'e49f55467666455717aeb6e0c4170a801385e806cbc6b564d061e103388e74b3',read:function(){return typeof liberarCatalogoTreinamentosSahmtV2==='function'?liberarCatalogoTreinamentosSahmtV2:null;}},
  {name:'listFirestoreDocumentsPaged_',sha256:'806c3ebb2ceed3bfc3760e0ce2762cc472dab5eb56da9d7ed8ba5e4815ca0fa9',read:function(){return typeof listFirestoreDocumentsPaged_==='function'?listFirestoreDocumentsPaged_:null;}},
  {name:'listPendingChecklistSignatureRequests_',sha256:'6533fa8608bf4f44c531b1042ab514d76a76dc2fe779e39adfd258e75ddd23d1',read:function(){return typeof listPendingChecklistSignatureRequests_==='function'?listPendingChecklistSignatureRequests_:null;}},
  {name:'listPendingManagementScoreReviews_',sha256:'a60b5e41689beaed9e3d6e25d697378cc31b77db303d9ef304516e3d89728706',read:function(){return typeof listPendingManagementScoreReviews_==='function'?listPendingManagementScoreReviews_:null;}},
  {name:'listPendingTrainingCompletions_',sha256:'633c3c0e3dbf5678b3bd6d94d2bf0a34c4fc5775e092eeec92f93588e4044cd5',read:function(){return typeof listPendingTrainingCompletions_==='function'?listPendingTrainingCompletions_:null;}},
  {name:'listSparkReportChanges_',sha256:'3904d3e5a8a1cd0734b2264c61fcd9a80dca0b1309204a3e8a671c19bfccd3d7',read:function(){return typeof listSparkReportChanges_==='function'?listSparkReportChanges_:null;}},
  {name:'managementActivityScoreId_',sha256:'ca9237a6392535c75b236fa0a796e9be8975203e6470adf21284872c02e4bfce',read:function(){return typeof managementActivityScoreId_==='function'?managementActivityScoreId_:null;}},
  {name:'managementScoreMatches_',sha256:'d43e8d77f553928fcb79bfed5594e5801fbdd0b3aed3ee117115bcb0bec22d77',read:function(){return typeof managementScoreMatches_==='function'?managementScoreMatches_:null;}},
  {name:'managementScoreReviewerAllowed_',sha256:'7daca0ed07940fb0a78b6bad66570dceb0a405100458f15f0c67658f987a392c',read:function(){return typeof managementScoreReviewerAllowed_==='function'?managementScoreReviewerAllowed_:null;}},
  {name:'managementScoreReviewUpdateWrite_',sha256:'e17e20d609118002fedbdeb88b67a821a147cbd199203994451fa8781f5fedd2',read:function(){return typeof managementScoreReviewUpdateWrite_==='function'?managementScoreReviewUpdateWrite_:null;}},
  {name:'managementScoreValidPoints_',sha256:'3f00bf519f1b82e1b8790e274d6d50b94f3d627b42c4a3938bf8cd370549719b',read:function(){return typeof managementScoreValidPoints_==='function'?managementScoreValidPoints_:null;}},
  {name:'normalizeChecklistText_',sha256:'dcc0430e65255221c3538a924889f504376c63081609db8c1b89f1d2039ddbdf',read:function(){return typeof normalizeChecklistText_==='function'?normalizeChecklistText_:null;}},
  {name:'onEvaluationFormSubmit',sha256:'f7d188a67b7306ca751510b55c841ac5271ace0b2b0e0197305a228fe5cc1b12',read:function(){return typeof onEvaluationFormSubmit==='function'?onEvaluationFormSubmit:null;}},
  {name:'parseVacationSiglas_',sha256:'87d4c10dd5059fce6549b2054f967c14bac8ec1e34d6bd969547d1e2122c55d0',read:function(){return typeof parseVacationSiglas_==='function'?parseVacationSiglas_:null;}},
  {name:'prepararCatalogoTreinamentosSahmtV2',sha256:'02be2ab30c5042024506155d161c6975e7dae36ebeb349aa9bdd5ab6bf76238b',read:function(){return typeof prepararCatalogoTreinamentosSahmtV2==='function'?prepararCatalogoTreinamentosSahmtV2:null;}},
  {name:'prepareEvaluationTemplate',sha256:'fe5a025dd8e0ad2c454d2ab18a8ae9b564e820b7004efea28c0b21a9ef38d5c6',read:function(){return typeof prepareEvaluationTemplate==='function'?prepareEvaluationTemplate:null;}},
  {name:'previewScheduleSourceToFirestore',sha256:'976240d4c740006ef7efeb0bfbca2d530cadf9eb7d412b5d1f63b145cbbddade',read:function(){return typeof previewScheduleSourceToFirestore==='function'?previewScheduleSourceToFirestore:null;}},
  {name:'processEvaluationRequests',sha256:'563a378827daf2be6a7ede4ebd17972a70e18b59be90b88ad81c25a282157756',read:function(){return typeof processEvaluationRequests==='function'?processEvaluationRequests:null;}},
  {name:'publishScheduleSourceToFirestore',sha256:'5a575ebe72396d7c4fec93cd3c179c6909d348c4bbbbf8c4209bd9cd25f8bd12',read:function(){return typeof publishScheduleSourceToFirestore==='function'?publishScheduleSourceToFirestore:null;}},
  {name:'queryFirestore_',sha256:'a824abe752629756826078eefa2dee2d7ed40e59925c1256bd58391b700c2e0b',read:function(){return typeof queryFirestore_==='function'?queryFirestore_:null;}},
  {name:'readScheduleFirestore_',sha256:'f813edf81dd0b8c1a9692d39b394f1907ae40f983fb4dc6c381bde2a98b51ad5',read:function(){return typeof readScheduleFirestore_==='function'?readScheduleFirestore_:null;}},
  {name:'readScheduleRows_',sha256:'dc4462f6e834bb120ba58a1700c0d3dc596325d1eac3cec5d5d7a2853c48aa27',read:function(){return typeof readScheduleRows_==='function'?readScheduleRows_:null;}},
  {name:'readScheduleSource_',sha256:'537a52828f8ddce5c84ae36f57899bf53bb047beb6da8cd90b95911381b457b6',read:function(){return typeof readScheduleSource_==='function'?readScheduleSource_:null;}},
  {name:'readTrustedChecklistSnapshot_',sha256:'96fda6badde28e68fdbb3d7f4f83a3a881671e817815891b7addf4957934894e',read:function(){return typeof readTrustedChecklistSnapshot_==='function'?readTrustedChecklistSnapshot_:null;}},
  {name:'readVacationMatrixRows_',sha256:'a7450409e326aae27abddfbcf0a9815839aef6c7f5dc1128ad9a92acdba5c33f',read:function(){return typeof readVacationMatrixRows_==='function'?readVacationMatrixRows_:null;}},
  {name:'readVacationRows_',sha256:'676fd083d15a557ab6c06f5251207e71502ba17a51a581542e86b50585223754',read:function(){return typeof readVacationRows_==='function'?readVacationRows_:null;}},
  {name:'reconcileChecklistResponsibilities',sha256:'2576e5cedc022ef6b98f445d07f44052962375b38bb1650e9e1b40c92188ef5d',read:function(){return typeof reconcileChecklistResponsibilities==='function'?reconcileChecklistResponsibilities:null;}},
  {name:'reconcileEvaluationLinks',sha256:'4bef9256f7cdbb562dbb28285ae3176396321b501327df3babfa9c38442c39b7',read:function(){return typeof reconcileEvaluationLinks==='function'?reconcileEvaluationLinks:null;}},
  {name:'reconcileEvaluationResponderAccess',sha256:'2defb39e91e60729ebccedf540f751faa4bd13a6ab892f2d75bd0917d708e0cc',read:function(){return typeof reconcileEvaluationResponderAccess==='function'?reconcileEvaluationResponderAccess:null;}},
  {name:'reconcileEvaluationResponses',sha256:'ad811a8a3ea66e7fe8de82d38199ca4f4cd5e0b3cd7801739b02e48a3bcf53fb',read:function(){return typeof reconcileEvaluationResponses==='function'?reconcileEvaluationResponses:null;}},
  {name:'reconciliarAvaliacaoSahmtV2',sha256:'4281c7a50afde82a31a8e490c447520e7147849c3e1f2b6cc504a84104cff032',read:function(){return typeof reconciliarAvaliacaoSahmtV2==='function'?reconciliarAvaliacaoSahmtV2:null;}},
  {name:'refreshChecklistResponsibilityProjection',sha256:'97c0e0242431b149059da0dc60286b78c4b3586aaca36cb7750381bae1973af2',read:function(){return typeof refreshChecklistResponsibilityProjection==='function'?refreshChecklistResponsibilityProjection:null;}},
  {name:'reportValuesForSpark_',sha256:'18215b5dbca6f5572510da16ab5d68bf306e9936633b7533188f86128ba52a4d',read:function(){return typeof reportValuesForSpark_==='function'?reportValuesForSpark_:null;}},
  {name:'requireScheduleSourceOperator_',sha256:'ff4301cc84e9e3a761bfffbe14dc6f39c9cb7bfbeb5fd63cd415f4987f64e2d3',read:function(){return typeof requireScheduleSourceOperator_==='function'?requireScheduleSourceOperator_:null;}},
  {name:'requireSparkReportTabs_',sha256:'3e836e722b11158541abe868a31e8a756f01076458a7131281c2b77b0ab530af',read:function(){return typeof requireSparkReportTabs_==='function'?requireSparkReportTabs_:null;}},
  {name:'resetSahmtV2SparkReportCursors',sha256:'a550343ae4750d7d68c98434fc654b9740c0061b2fb481443abe79e097316936',read:function(){return typeof resetSahmtV2SparkReportCursors==='function'?resetSahmtV2SparkReportCursors:null;}},
  {name:'retomarDisponibilizacaoTreinamentosSahmtV2',sha256:'949b83b1407b1f130b4361bb5c951b44b671593830150e19c060d59dec71cc87',read:function(){return typeof retomarDisponibilizacaoTreinamentosSahmtV2==='function'?retomarDisponibilizacaoTreinamentosSahmtV2:null;}},
  {name:'sahmtV2FindExistingReportsSpreadsheet_',sha256:'74d62c59d24e2b1ea633faeff6f4b4aafb04320364432df98d71d4874498d505',read:function(){return typeof sahmtV2FindExistingReportsSpreadsheet_==='function'?sahmtV2FindExistingReportsSpreadsheet_:null;}},
  {name:'sahmtV2Properties_',sha256:'9922af8b00d3d5b8d05c32c3f268ea02c5fa151261717c38909f8ee4f092ebdb',read:function(){return typeof sahmtV2Properties_==='function'?sahmtV2Properties_:null;}},
  {name:'sahmtV2RequirePrivateFolder_',sha256:'27c8464a94c4c51371d5a8e8269770b8339d35f56aafa07edd9cc3dc7a0a76e5',read:function(){return typeof sahmtV2RequirePrivateFolder_==='function'?sahmtV2RequirePrivateFolder_:null;}},
  {name:'sahmtV2RequirePrivateSpreadsheet_',sha256:'101999d961289b47703f0087f1352b4e8219bce4e1920c7347e3f70e6ad6dbf8',read:function(){return typeof sahmtV2RequirePrivateSpreadsheet_==='function'?sahmtV2RequirePrivateSpreadsheet_:null;}},
  {name:'sahmtV2SpreadsheetId_',sha256:'b23da740c32c6989c8d24841129f831aef507300c09225e95c06633af873ff9e',read:function(){return typeof sahmtV2SpreadsheetId_==='function'?sahmtV2SpreadsheetId_:null;}},
  {name:'saveSparkReportCursor_',sha256:'5df78aaec0236e1906c5a26bc13e9ce35e36e6d8e2f27f9f9b71fec4484069c4',read:function(){return typeof saveSparkReportCursor_==='function'?saveSparkReportCursor_:null;}},
  {name:'schedulePositionsEqual_',sha256:'a90bd81c1a5f474fb20409b9364280462cf8124f8d758ddc785c700aa5757435',read:function(){return typeof schedulePositionsEqual_==='function'?schedulePositionsEqual_:null;}},
  {name:'scheduleSourceDate_',sha256:'f24ba261d6f1b12b767f040aaaccf46fa955d526c3405fbe9fc59de58eba3928',read:function(){return typeof scheduleSourceDate_==='function'?scheduleSourceDate_:null;}},
  {name:'scheduleSourceDateParts_',sha256:'de907757376a1bafe7cffa92c5cbe7847ab63902bec3b111b00f6463aaffa479',read:function(){return typeof scheduleSourceDateParts_==='function'?scheduleSourceDateParts_:null;}},
  {name:'scheduleTargetFingerprint_',sha256:'abf07118b38d0ed42378c7902346b94c77e04436a00529d49c447dcd05e0fb66',read:function(){return typeof scheduleTargetFingerprint_==='function'?scheduleTargetFingerprint_:null;}},
  {name:'selectChecklistResponsible_',sha256:'3001afb8023503332089e71ac8e0762e60e710d87c7bf042e1c4adc83068fdbc',read:function(){return typeof selectChecklistResponsible_==='function'?selectChecklistResponsible_:null;}},
  {name:'setupSahmtV2Reporting',sha256:'77a4f64e026e85d78a6cf220d361851e93d605d2c81adf6a7748bca6bee9f7ae',read:function(){return typeof setupSahmtV2Reporting==='function'?setupSahmtV2Reporting:null;}},
  {name:'sha256Hex_',sha256:'aada8019a562142f724444f247bd157972a6f75a6f8ac0f29f7100225099a345',read:function(){return typeof sha256Hex_==='function'?sha256Hex_:null;}},
  {name:'syncSparkReportsPeriodically',sha256:'6352e3cd18e79dec13f08943dc9fad0a960d79426ed10b537168a2329af0d64d',read:function(){return typeof syncSparkReportsPeriodically==='function'?syncSparkReportsPeriodically:null;}},
  {name:'trainingProfileCanRead_',sha256:'e098bb32de1888c8c79ec532e5e6cdc8076948001db6f4cecf4a73fcdc09336c',read:function(){return typeof trainingProfileCanRead_==='function'?trainingProfileCanRead_:null;}},
  {name:'trainingReleaseBatch_',sha256:'2504cde9edaaa58bf4e873e26f483288a9163abce507a2f1e9d5bdf7fca4168b',read:function(){return typeof trainingReleaseBatch_==='function'?trainingReleaseBatch_:null;}},
  {name:'trainingReleaseCloneAccess_',sha256:'07fa0ea0887e29d72888bd71a3a13f72bbf58665692d9d81814547a2003a1e72',read:function(){return typeof trainingReleaseCloneAccess_==='function'?trainingReleaseCloneAccess_:null;}},
  {name:'trainingReleaseContext_',sha256:'a6e180288c2d3a473b3ed6b55fdaa73f5263f206b8ef11680461d89c05938432',read:function(){return typeof trainingReleaseContext_==='function'?trainingReleaseContext_:null;}},
  {name:'trainingReleaseCounts_',sha256:'f6a4548f77e1bcce8e7b8bbbda3187a18b0a8375b9ce2e6282209605b2b87943',read:function(){return typeof trainingReleaseCounts_==='function'?trainingReleaseCounts_:null;}},
  {name:'trainingReleaseFailClosed_',sha256:'d9870b894bfe4ec026f69d39f3ce71e97b868520fed6a0d6166de6d5d034b3fc',read:function(){return typeof trainingReleaseFailClosed_==='function'?trainingReleaseFailClosed_:null;}},
  {name:'trainingReleaseFinalize_',sha256:'b8659dc3d6a0a3216837691d1363725426eb463353284675cb36fc1539b5c050',read:function(){return typeof trainingReleaseFinalize_==='function'?trainingReleaseFinalize_:null;}},
  {name:'trainingReleaseIdentity_',sha256:'6438c4b019e24e493c22216c961f52631b852083c884dffb09d084ec6b3c4c4d',read:function(){return typeof trainingReleaseIdentity_==='function'?trainingReleaseIdentity_:null;}},
  {name:'trainingReleaseJobError_',sha256:'d5e9709f399cad180ce54613468479db9c07c3f7bba8677a36db141feebffff3',read:function(){return typeof trainingReleaseJobError_==='function'?trainingReleaseJobError_:null;}},
  {name:'trainingReleaseLimitClone_',sha256:'5b4040dc0c32e923c4dd0b57a31849195938094c57e37134aaa1123af71a3d5f',read:function(){return typeof trainingReleaseLimitClone_==='function'?trainingReleaseLimitClone_:null;}},
  {name:'trainingReleaseLive_',sha256:'99c8db793b23f75e4752a790225bb9170aa3aaf88d03fb2ba75146bc2b10079f',read:function(){return typeof trainingReleaseLive_==='function'?trainingReleaseLive_:null;}},
  {name:'trainingReleaseLoad_',sha256:'887d1ab1dacbf8269c2ee9deb39386c2f07da2cda2075038d4fcc1f24e87900a',read:function(){return typeof trainingReleaseLoad_==='function'?trainingReleaseLoad_:null;}},
  {name:'trainingReleaseLog_',sha256:'cba5f902a0a9f0f42e20737e36079327c69c07acda155d3e9edf1f6c5a3985cb',read:function(){return typeof trainingReleaseLog_==='function'?trainingReleaseLog_:null;}},
  {name:'trainingReleaseManagement_',sha256:'d312a5e12a8b9ccfb2de5fcd5a8a7c2d63d7c0bd805c9f54464b922644774ed7',read:function(){return typeof trainingReleaseManagement_==='function'?trainingReleaseManagement_:null;}},
  {name:'trainingReleaseManagementCloseWrite_',sha256:'a08f499507d2e6dcd1cbb2b9e464a16181071190e5fde3cdf3f4ad836b884730',read:function(){return typeof trainingReleaseManagementCloseWrite_==='function'?trainingReleaseManagementCloseWrite_:null;}},
  {name:'trainingReleaseManagementFields_',sha256:'826ea14ec9ecf9af0b5dbf268571886578a259cfec55ab4cd667f73601e93e39',read:function(){return typeof trainingReleaseManagementFields_==='function'?trainingReleaseManagementFields_:null;}},
  {name:'trainingReleaseManagementOwned_',sha256:'4ce137b0f95d292f319243a057714916eff57e165a5e6761e6f247d1ade6ef6a',read:function(){return typeof trainingReleaseManagementOwned_==='function'?trainingReleaseManagementOwned_:null;}},
  {name:'trainingReleaseManifestShape_',sha256:'8461b5c51603bc7d98e54d4174396b9d64c1860deefbd236a30336553a0ab29c',read:function(){return typeof trainingReleaseManifestShape_==='function'?trainingReleaseManifestShape_:null;}},
  {name:'trainingReleaseMaterialAudience_',sha256:'af47570833468386105e6dbcac3456550ad5d60a5ae346622695175084529dc5',read:function(){return typeof trainingReleaseMaterialAudience_==='function'?trainingReleaseMaterialAudience_:null;}},
  {name:'trainingReleaseMaterialBatch_',sha256:'8d74ab27098ca31a531a5f499edc1bfeb3780da85a3126a79d7e36edd8b1be3e',read:function(){return typeof trainingReleaseMaterialBatch_==='function'?trainingReleaseMaterialBatch_:null;}},
  {name:'trainingReleaseMaterialCatalog_',sha256:'cf669686e802213ff9e01816453a07e5c1a1df723b966d775e4d2a286d098abc',read:function(){return typeof trainingReleaseMaterialCatalog_==='function'?trainingReleaseMaterialCatalog_:null;}},
  {name:'trainingReleaseMaterialExact_',sha256:'2dce2ca3cc6901ee3038af667bf61e4b8d9800872f66e151fe33143db65e4da3',read:function(){return typeof trainingReleaseMaterialExact_==='function'?trainingReleaseMaterialExact_:null;}},
  {name:'trainingReleaseMaterialMetadata_',sha256:'4bda91e60ab37aadf35f704e82fcbb8c2f1000f9c7ddb4278df4ee34c72179d6',read:function(){return typeof trainingReleaseMaterialMetadata_==='function'?trainingReleaseMaterialMetadata_:null;}},
  {name:'trainingReleaseMaterialPermissions_',sha256:'836406b698b12319f36ae5a92aedab9544c6247bc70e77f8a7d68659c3bf2e5e',read:function(){return typeof trainingReleaseMaterialPermissions_==='function'?trainingReleaseMaterialPermissions_:null;}},
  {name:'trainingReleaseMaterialQueue_',sha256:'8c33c7df107c7ebe5cf2902c50c35295ae6df786af9270e000be03d34074c566',read:function(){return typeof trainingReleaseMaterialQueue_==='function'?trainingReleaseMaterialQueue_:null;}},
  {name:'trainingReleaseMaterialVerify_',sha256:'4253b3a749c421b4ec7a1476915a14ceda8a43bf1f360c7923e273b0880ddd9c',read:function(){return typeof trainingReleaseMaterialVerify_==='function'?trainingReleaseMaterialVerify_:null;}},
  {name:'trainingReleaseMaterialWave_',sha256:'508abc13668e2c965a66a8388a788e2f6c3c5d4861c7f96435d100acd0122a45',read:function(){return typeof trainingReleaseMaterialWave_==='function'?trainingReleaseMaterialWave_:null;}},
  {name:'trainingReleasePayload_',sha256:'8ecbd91e1687513a5d2baad00390249d4a4700db64ebc57c8d4e1d9611f34b47',read:function(){return typeof trainingReleasePayload_==='function'?trainingReleasePayload_:null;}},
  {name:'trainingReleasePrepared_',sha256:'056fc63e5bb2d352bbc469f0ee0d04dd7980d7a773262af36dfde49037d78f18',read:function(){return typeof trainingReleasePrepared_==='function'?trainingReleasePrepared_:null;}},
  {name:'trainingReleaseReject_',sha256:'cd37cd364aaaab6166c484168d809188870c5b1d5a9b171e77c214730d016439',read:function(){return typeof trainingReleaseReject_==='function'?trainingReleaseReject_:null;}},
  {name:'trainingReleaseReleased_',sha256:'c2de773009c9ae65672fd16a9aee2c70d39ccb3558f87bbef180519f425f74ce',read:function(){return typeof trainingReleaseReleased_==='function'?trainingReleaseReleased_:null;}},
  {name:'trainingReleaseSaved_',sha256:'10d4152a6d7982b13883e657fd41044e244f66dee22b7837fd4f1824ab1ba8bf',read:function(){return typeof trainingReleaseSaved_==='function'?trainingReleaseSaved_:null;}},
  {name:'trainingReleaseShape_',sha256:'47c9123fc314bde66e896757669deccb3c41e42205026791b285efd5e3a7dd39',read:function(){return typeof trainingReleaseShape_==='function'?trainingReleaseShape_:null;}},
  {name:'trainingReleaseSource_',sha256:'d5b2651cff8550d7084a7061b5b20dd43f439519b26e004443a16952571b2da7',read:function(){return typeof trainingReleaseSource_==='function'?trainingReleaseSource_:null;}},
  {name:'trainingReleaseStopTrigger_',sha256:'e2680a92f4019e70ece3a4f74ca20406c97f55b269adce6e6e74270340c3728b',read:function(){return typeof trainingReleaseStopTrigger_==='function'?trainingReleaseStopTrigger_:null;}},
  {name:'trainingReleaseVerifyPublication_',sha256:'b90ea84d4a8b3a6f6e130ff4fb721ddc3c39c002d0903ca6c47e15e4f36601e7',read:function(){return typeof trainingReleaseVerifyPublication_==='function'?trainingReleaseVerifyPublication_:null;}},
  {name:'trainingReleaseWithLock_',sha256:'758ba535d3d8d2a9696c3839d733ae9ec1b0736a3b566ad56279ebc9978c810f',read:function(){return typeof trainingReleaseWithLock_==='function'?trainingReleaseWithLock_:null;}},
  {name:'trainingSameScore_',sha256:'6cc44a18da3f37156a89d85ae7d2ebace556ab005c6b850fed22ff023357f328',read:function(){return typeof trainingSameScore_==='function'?trainingSameScore_:null;}},
  {name:'trainingScoreCreateWrite_',sha256:'edf58fdc9d7ff3348e0f7c93ccdb1fa649b8b136577a20990452d766d7a4cb1a',read:function(){return typeof trainingScoreCreateWrite_==='function'?trainingScoreCreateWrite_:null;}},
  {name:'trainingScoreKey_',sha256:'28c3253266aab35668176711b6efbbd1456d02e6b8c3d4997c8ec81cbcbcb653',read:function(){return typeof trainingScoreKey_==='function'?trainingScoreKey_:null;}},
  {name:'trainingScoreRecord_',sha256:'d96430bb692dc500fb99d2c341796cd9475253bc63a9bd1eb312003a15645366',read:function(){return typeof trainingScoreRecord_==='function'?trainingScoreRecord_:null;}},
  {name:'trainingUpdateWrite_',sha256:'2cb37553ec1164a2b6c328cb52e519a2a95b1a2abaf724121598f60a2d51c4d1',read:function(){return typeof trainingUpdateWrite_==='function'?trainingUpdateWrite_:null;}},
  {name:'trainingValidPoints_',sha256:'247f685c44dcd0393d80f702a7c7dc239554ece807c9afb45510e2b601fc8c5a',read:function(){return typeof trainingValidPoints_==='function'?trainingValidPoints_:null;}},
  {name:'trainingWatchedCoverage_',sha256:'8c18ced5e06a2df562be4884d78aaf392fda5ceb8277fd1b23f47e0a7b4e159a',read:function(){return typeof trainingWatchedCoverage_==='function'?trainingWatchedCoverage_:null;}},
  {name:'updateChecklistRequestStatus_',sha256:'eb767f2246c54a1558dd58ce7a72498bebfcdec9193cb92c675951ff5d8a7799',read:function(){return typeof updateChecklistRequestStatus_==='function'?updateChecklistRequestStatus_:null;}},
  {name:'updateManagementScoreReview_',sha256:'51109bacb0ec9a37b2b77c856ac2cca016a42482fa77d115b047a9d496ee52ad',read:function(){return typeof updateManagementScoreReview_==='function'?updateManagementScoreReview_:null;}},
  {name:'updateTrainingValidationStatus_',sha256:'16a558ec523abf910acc7c67637b48cc81807aaf9f50d88acfac59454b770002',read:function(){return typeof updateTrainingValidationStatus_==='function'?updateTrainingValidationStatus_:null;}},
  {name:'upsertSparkReportRows_',sha256:'5c48a4021cddc0f10bfc464c326b8950c45d4e42c7e7707822484ea60ce237b9',read:function(){return typeof upsertSparkReportRows_==='function'?upsertSparkReportRows_:null;}},
  {name:'validateChecklistSignatureRequest_',sha256:'445c81ead89b309d0d985c7585cb92a085aeb4d21ee89425afbf94714b69808b',read:function(){return typeof validateChecklistSignatureRequest_==='function'?validateChecklistSignatureRequest_:null;}},
  {name:'validateManagementScoreReview_',sha256:'e8e64b08ae1068a072de36633642f9888fd7235c92120e7afe27746ec9391fa2',read:function(){return typeof validateManagementScoreReview_==='function'?validateManagementScoreReview_:null;}},
  {name:'validatePendingChecklistSignatureRequests',sha256:'1c9ec7e1e0fd106c55dd1b500f6eb03cbd9f26c0ef741af789002984d44e0cea',read:function(){return typeof validatePendingChecklistSignatureRequests==='function'?validatePendingChecklistSignatureRequests:null;}},
  {name:'validatePendingManagementScoreReviews',sha256:'59bc71baf17af1f722087b82ee1e95c2ce0a2d51883f25d478aea73818bc72f3',read:function(){return typeof validatePendingManagementScoreReviews==='function'?validatePendingManagementScoreReviews:null;}},
  {name:'validatePendingTrainingCompletions',sha256:'d7a1396f4df824b139f37364d2fda3e708772b1510aa7b3eed2494a5a5ee1a3b',read:function(){return typeof validatePendingTrainingCompletions==='function'?validatePendingTrainingCompletions:null;}},
  {name:'validateTrainingCompletionClaim_',sha256:'b4c28c59a460fc5df636978619fce8eaabbcc5980f041b13ad1fa4455dcbcf02',read:function(){return typeof validateTrainingCompletionClaim_==='function'?validateTrainingCompletionClaim_:null;}},
  {name:'verifySahmtV2ExecutorReadOnly',sha256:'8e5299c9bb5115e5696036b704e309c6d07604801ffeb1c61d6084c64c0d982b',read:function(){return typeof verifySahmtV2ExecutorReadOnly==='function'?verifySahmtV2ExecutorReadOnly:null;}},
  {name:'writeCurrentChecklistResponsibilityProjection_',sha256:'2b249414836f2244294cf21b3bfcb5f015c1f42d775c1c92a54d7b4c36135602',read:function(){return typeof writeCurrentChecklistResponsibilityProjection_==='function'?writeCurrentChecklistResponsibilityProjection_:null;}}
 ],
 constants:[
  {name:'SAHMT_V2_CHECKLIST_VALIDATION',sha256:'adc8b5958612003636d33f8e39314b41097f788cc943eabb995dc354bad2d9ce',read:function(){return typeof SAHMT_V2_CHECKLIST_VALIDATION==='undefined'?null:SAHMT_V2_CHECKLIST_VALIDATION;}},
  {name:'SAHMT_V2_CONFIG',sha256:'b9576d12ea30660ff1542af4bf4932bab19fbdc747df1dc362cf45f3538389d8',read:function(){return typeof SAHMT_V2_CONFIG==='undefined'?null:SAHMT_V2_CONFIG;}},
  {name:'SAHMT_V2_DC_ALIASES',sha256:'995eb77cc70cfc1693632ee0e26ea04d7d6fcdff06c52d19cafbb7a418b8b159',read:function(){return typeof SAHMT_V2_DC_ALIASES==='undefined'?null:SAHMT_V2_DC_ALIASES;}},
  {name:'SAHMT_V2_DC_FALLBACK',sha256:'f93a11e481c722fc13f036c6cff0915719985f8447a0474bfcf5f7658fbadd0e',read:function(){return typeof SAHMT_V2_DC_FALLBACK==='undefined'?null:SAHMT_V2_DC_FALLBACK;}},
  {name:'SAHMT_V2_EVALUATION_FORMS',sha256:'010bdb941896f3cbb1235b57020643539a3afb3ffec851fb13741fa81c03c286',read:function(){return typeof SAHMT_V2_EVALUATION_FORMS==='undefined'?null:SAHMT_V2_EVALUATION_FORMS;}},
  {name:'SAHMT_V2_EVALUATION_LEDGER',sha256:'3db8379ac7cfc8de8ae8ea0a8fba4c1cc2832abd837ed6990b7d8f0254434728',read:function(){return typeof SAHMT_V2_EVALUATION_LEDGER==='undefined'?null:SAHMT_V2_EVALUATION_LEDGER;}},
  {name:'SAHMT_V2_MANAGEMENT_SCORE_VALIDATION',sha256:'30e775e074210701d4e7cb2d06d05a6b31c645fc36c4524777ab3f96564385bf',read:function(){return typeof SAHMT_V2_MANAGEMENT_SCORE_VALIDATION==='undefined'?null:SAHMT_V2_MANAGEMENT_SCORE_VALIDATION;}},
  {name:'SAHMT_V2_REPORT_TABS',sha256:'235aaf4b9c300cee31a1b72c2aecb17bc5d38b9ff6babc52e7abfd0c25c3d3a1',read:function(){return typeof SAHMT_V2_REPORT_TABS==='undefined'?null:SAHMT_V2_REPORT_TABS;}},
  {name:'SAHMT_V2_RESOURCE_TABS',sha256:'23b41907da160487a7c4de362faf049cf7d8d73c5ecf389a7bfd26688460ef3a',read:function(){return typeof SAHMT_V2_RESOURCE_TABS==='undefined'?null:SAHMT_V2_RESOURCE_TABS;}},
  {name:'SAHMT_V2_SCHEDULE_SOURCE',sha256:'18d04c08e306da963a3fb4748ccd05fbf68120752a6deba6e3c3f77a8ead1de1',read:function(){return typeof SAHMT_V2_SCHEDULE_SOURCE==='undefined'?null:SAHMT_V2_SCHEDULE_SOURCE;}},
  {name:'SAHMT_V2_SPARK_REPORT_SCAN',sha256:'af39714b3fd4c1f3844a2a7f328b5f8d4ac0a3ff4caa743f6a2757cc81952b10',read:function(){return typeof SAHMT_V2_SPARK_REPORT_SCAN==='undefined'?null:SAHMT_V2_SPARK_REPORT_SCAN;}},
  {name:'SAHMT_V2_TRAINING_RELEASE',sha256:'38acc15ec8f1b64beab24d3884569b6d3167ed25765c324110230368d0c4e09e',read:function(){return typeof SAHMT_V2_TRAINING_RELEASE==='undefined'?null:SAHMT_V2_TRAINING_RELEASE;}},
  {name:'SAHMT_V2_TRAINING_VALIDATION',sha256:'083196575b0fbf664823fb0de2b6ae63ec01b9d158967d4e2a0be95f4bbbf64e',read:function(){return typeof SAHMT_V2_TRAINING_VALIDATION==='undefined'?null:SAHMT_V2_TRAINING_VALIDATION;}}
 ]
});
class ManagementMigrationNativeInventoryError_ extends Error {}
function managementMigrationNativeInventoryCode_(condition, code) { if (!condition) throw new ManagementMigrationNativeInventoryError_(code); }
function managementMigrationNativeInventorySha_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function(byte){return ('0'+((byte+256)%256).toString(16)).slice(-2);}).join('');
}
function managementMigrationNativeInventoryCanonical_(value, depth, state) {
  depth=depth||0;state=state||{nodes:0};
  managementMigrationNativeInventoryCode_(depth<=30&&++state.nodes<=20000,'MMI_CONFIG_DATA_INVALID');
  if(value===null||typeof value==='boolean'||typeof value==='string') return JSON.stringify(value);
  if(typeof value==='number') {managementMigrationNativeInventoryCode_(Number.isFinite(value),'MMI_CONFIG_DATA_INVALID');return JSON.stringify(value);}
  managementMigrationNativeInventoryCode_(value&&typeof value==='object','MMI_CONFIG_DATA_INVALID');
  var keys=Reflect.ownKeys(value);
  if(Array.isArray(value)) {
    managementMigrationNativeInventoryCode_(keys.length===value.length+1&&keys.every(function(key){return key==='length'||typeof key==='string'&&/^(0|[1-9][0-9]*)$/.test(key);}), 'MMI_CONFIG_DATA_INVALID');
    var items=[];
    for(var index=0;index<value.length;index++) {
      var item=Object.getOwnPropertyDescriptor(value,String(index));
      managementMigrationNativeInventoryCode_(item&&item.enumerable&&Object.prototype.hasOwnProperty.call(item,'value'),'MMI_CONFIG_DATA_INVALID');
      items.push(managementMigrationNativeInventoryCanonical_(item.value,depth+1,state));
    }
    return '['+items.join(',')+']';
  }
  managementMigrationNativeInventoryCode_(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null,'MMI_CONFIG_DATA_INVALID');
  return '{'+keys.sort().map(function(key){
    var item=Object.getOwnPropertyDescriptor(value,key);
    managementMigrationNativeInventoryCode_(typeof key==='string'&&item.enumerable&&Object.prototype.hasOwnProperty.call(item,'value'),'MMI_CONFIG_DATA_INVALID');
    return JSON.stringify(key)+':'+managementMigrationNativeInventoryCanonical_(item.value,depth+1,state);
  }).join(',')+'}';
}
function managementMigrationNativeInventoryOwn_(value,key) {
  var item=value&&Object.getOwnPropertyDescriptor(value,key);
  managementMigrationNativeInventoryCode_(item&&item.enumerable&&Object.prototype.hasOwnProperty.call(item,'value'),'MMI_ROUTING_DYNAMIC_OR_MISSING');
  return item.value;
}
function managementMigrationNativeInventoryFlag_(value) {
  if(value===null) return 'NOT_CONFIGURED';
  if(value==='true') return 'EXPLICIT_TRUE';
  if(value==='false') return 'EXPLICIT_FALSE';
  return 'UNKNOWN';
}
function managementMigrationNativeInventoryNative_() {
  var known={
    validatePendingManagementScoreReviews:'MANAGEMENT', validatePendingTrainingCompletions:'MANAGEMENT',
    reconciliarAvaliacaoSahmtV2:'MANAGEMENT', reconcileEvaluationLinks:'MANAGEMENT',
    onEvaluationFormSubmit:'MANAGEMENT', processEvaluationRequests:'MANAGEMENT',
    reconcileEvaluationResponderAccess:'MANAGEMENT', reconcileEvaluationResponses:'MANAGEMENT',
    continuarDisponibilizacaoTreinamentosSahmtV2_:'MANAGEMENT', reconcileChecklistResponsibilities:'MANAGEMENT',
    syncSparkReportsPeriodically:'REPORTS', validatePendingChecklistSignatureRequests:'OPERATIONAL',
    refreshChecklistResponsibilityProjection:'OPERATIONAL'
  };
  var triggers=ScriptApp.getProjectTriggers();
  managementMigrationNativeInventoryCode_(Array.isArray(triggers)&&triggers.length<=1000,'MMI_TRIGGER_LOOKUP_UNAVAILABLE');
  var result={triggerLookupAvailable:true,visibleCurrentUserTriggerCount:triggers.length,unknownHandlerCount:0,
    unreadableTriggerCount:0,knownJobs:[],unknownJobs:[]};
  triggers.forEach(function(trigger,index){
    var slot='CURRENT_USER_JOB_'+(index+1);
    try {
      var handler=trigger.getHandlerFunction();
      if(typeof handler!=='string'||!Object.prototype.hasOwnProperty.call(known,handler)) {
        result.unknownHandlerCount++;result.unknownJobs.push({jobRef:slot,handler:'UNKNOWN_HANDLER',presence:'PRESENT',executionState:'UNVERIFIED',potentiallyExecutable:true});return;
      }
      var source=trigger.getTriggerSource(),event=trigger.getEventType();
      var sourceName=source===ScriptApp.TriggerSource.CLOCK?'CLOCK':source===ScriptApp.TriggerSource.FORMS?'FORMS':'UNKNOWN';
      var eventName=event===ScriptApp.EventType.CLOCK?'CLOCK':event===ScriptApp.EventType.ON_FORM_SUBMIT?'ON_FORM_SUBMIT':'UNKNOWN';
      var expected=handler==='onEvaluationFormSubmit'?sourceName==='FORMS'&&eventName==='ON_FORM_SUBMIT':sourceName==='CLOCK'&&eventName==='CLOCK';
      result.knownJobs.push({jobRef:slot,handler:handler,category:known[handler],presence:'PRESENT',
        triggerSource:sourceName,eventType:eventName,shapeVerified:expected,executionState:'UNVERIFIED',potentiallyExecutable:true});
      if(!expected) result.unreadableTriggerCount++;
    } catch(_) {result.unreadableTriggerCount++;result.unknownJobs.push({jobRef:slot,handler:'UNREADABLE_HANDLER',presence:'PRESENT',executionState:'UNVERIFIED',potentiallyExecutable:true});}
  });
  return result;
}
/** The only public entry point. Does not invoke any producer or Firestore/API helper. */
function consultarInventarioMigracaoGestaoNativaSahmtV2() {
  var startedAt=Date.now(),blockers=[];
  var result={schemaVersion:1,status:'INVENTORY_REQUIRES_REVIEW',scope:'APPS_SCRIPT_CURRENT_PROJECT_ONLY',
    triggerVisibility:'CURRENT_USER_ONLY',sourceProjectId:'sahmt-17a16',destinationProjectId:'sahmt-gestao-5ae66',
    complete:false,globalNativeProducerAbsenceCertified:false,otherTriggerOwnersInventoried:false,
    unknownManualOrSimpleProducersInventoried:false,writerState:'UNKNOWN',writerStateMeaning:'CONFIGURED_CAPABILITY_NOT_EXECUTION_CONFIRMATION',
    destinationNativeTriggersAbsent:false,observedAt:null,configuredFirestoreProjectId:'UNKNOWN',databaseId:'UNKNOWN',
    knownSourceCoverageVerified:false,configurationSha256:null,sourceBasisSha256:null,
    sourceVerification:{reviewedModuleCount:SAHMT_MIGRATION_NATIVE_INVENTORY_REVIEW_.reviewedModules.length,
      reviewedFunctionCount:SAHMT_MIGRATION_NATIVE_INVENTORY_REVIEW_.functions.length,verifiedFunctionCount:0,missingFunctionCount:0,
      changedFunctionCount:0,missingOrChangedConstantCount:0},
    native:{triggerLookupAvailable:false,visibleCurrentUserTriggerCount:0,unknownHandlerCount:0,unreadableTriggerCount:0,knownJobs:[],unknownJobs:[]},
    safeProperties:{evaluationEnabled:'UNKNOWN',evaluationHomologated:'UNKNOWN',trainingReleaseState:'UNKNOWN'},
    firestoreDocumentReadsIssued:0,firestoreWritesIssued:0,metricsRequestsIssued:0,authReadsIssued:0,authWritesIssued:0,
    propertyWrites:0,triggerWrites:0,financialWrites:0,externalRequestsIssued:0,allSideEffects:0,blockers:[]};
  try {
    managementMigrationNativeInventoryCode_(Number.isSafeInteger(startedAt)&&startedAt>0,'MMI_CLOCK_INVALID');
    result.observedAt=new Date(startedAt).toISOString();
    var scriptId=ScriptApp.getScriptId();
    managementMigrationNativeInventoryCode_(typeof scriptId==='string'&&scriptId.length>0&&scriptId.length<=200,'MMI_SCRIPT_PROJECT_UNAVAILABLE');
    var scriptProjectSha256=managementMigrationNativeInventorySha_(scriptId);
    if(scriptProjectSha256!==SAHMT_MIGRATION_NATIVE_INVENTORY_REVIEW_.scriptProjectSha256) blockers.push('MMI_SCRIPT_PROJECT_NOT_REVIEWED');
    var functions=[],constants=[];
    SAHMT_MIGRATION_NATIVE_INVENTORY_REVIEW_.functions.forEach(function(row){
      var fn=row.read(),digest=null;
      if(fn===null) result.sourceVerification.missingFunctionCount++;
      else {
        digest=managementMigrationNativeInventorySha_(Function.prototype.toString.call(fn).replace(/\r\n?/g,'\n').trim());
        if(digest!==row.sha256) result.sourceVerification.changedFunctionCount++;
        else result.sourceVerification.verifiedFunctionCount++;
      }
      functions.push({name:row.name,sha256:digest});
    });
    SAHMT_MIGRATION_NATIVE_INVENTORY_REVIEW_.constants.forEach(function(row){
      var value=row.read(),digest=null;
      try {if(value!==null) digest=managementMigrationNativeInventorySha_(managementMigrationNativeInventoryCanonical_(value));} catch(_) { /* Missing/dynamic configuration stays unknown. */ }
      if(digest!==row.sha256) result.sourceVerification.missingOrChangedConstantCount++;
      constants.push({name:row.name,sha256:digest});
    });
    var sourceBasis={schemaVersion:1,reviewedModules:SAHMT_MIGRATION_NATIVE_INVENTORY_REVIEW_.reviewedModules,functions:functions,constants:constants,scriptProjectSha256:scriptProjectSha256};
    result.sourceBasisSha256=managementMigrationNativeInventorySha_(managementMigrationNativeInventoryCanonical_(sourceBasis));
    if(result.sourceBasisSha256!==SAHMT_MIGRATION_NATIVE_INVENTORY_REVIEW_.sourceBasisSha256) blockers.push('MMI_SOURCE_NOT_PINNED_TO_REVIEW');
    var cfg=typeof SAHMT_V2_CONFIG==='undefined'?null:SAHMT_V2_CONFIG;
    var project=managementMigrationNativeInventoryOwn_(cfg,'projectId'),database=managementMigrationNativeInventoryOwn_(cfg,'databaseId');
    if(project==='sahmt-17a16'||project==='sahmt-gestao-5ae66') result.configuredFirestoreProjectId=project;
    if(database==='(default)') result.databaseId=database;
    if(project!=='sahmt-17a16'||database!=='(default)') blockers.push('MMI_ROUTING_TARGET_NOT_REVIEWED_FA');
    // Read only these declared, nonsensitive keys. No allowlist/email/secret/URL/property enumeration.
    var properties=PropertiesService.getScriptProperties();
    result.safeProperties.evaluationEnabled=managementMigrationNativeInventoryFlag_(properties.getProperty('SAHMT_V2_EVALUATION_ENABLED'));
    result.safeProperties.evaluationHomologated=managementMigrationNativeInventoryFlag_(properties.getProperty('SAHMT_V2_EVALUATION_HOMOLOGATED'));
    var job=properties.getProperty('SAHMT_V2_TRAINING_RELEASE_JOB');
    if(job===null) result.safeProperties.trainingReleaseState='NOT_STARTED';
    else {
      managementMigrationNativeInventoryCode_(typeof job==='string'&&job.length<=16384,'MMI_CHECKPOINT_UNREADABLE');
      var parsed;try {parsed=JSON.parse(job);}catch(_){managementMigrationNativeInventoryCode_(false,'MMI_CHECKPOINT_UNREADABLE');}
      if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&parsed.schemaVersion===2&&
        ['RUNNING','CONFIGURATION_PENDING','COMPLETED'].includes(parsed.status)) result.safeProperties.trainingReleaseState=parsed.status;
    }
    if(Object.keys(result.safeProperties).some(function(key){return result.safeProperties[key]==='UNKNOWN';})) blockers.push('MMI_PROPERTIES_UNKNOWN');
    result.native=managementMigrationNativeInventoryNative_();
    if(result.native.unknownHandlerCount||result.native.unreadableTriggerCount) blockers.push('MMI_NATIVE_HANDLER_OR_STATE_UNREVIEWED');
    var endedAt=Date.now();managementMigrationNativeInventoryCode_(Number.isSafeInteger(endedAt)&&endedAt>=startedAt&&endedAt-startedAt<30000,'MMI_CAPTURE_TIME_INVALID');
    result.knownSourceCoverageVerified=blockers.length===0;
    if(result.knownSourceCoverageVerified) {
      result.writerState='RUNNING_FA_ONLY';
      result.configurationSha256=managementMigrationNativeInventorySha_(managementMigrationNativeInventoryCanonical_({schemaVersion:1,
        scope:result.scope,triggerVisibility:result.triggerVisibility,sourceBasisSha256:result.sourceBasisSha256,
        configuredFirestoreProjectId:result.configuredFirestoreProjectId,databaseId:result.databaseId}));
      result.native.knownJobs.forEach(function(job){job.firestoreProjectId='sahmt-17a16';});
      result.status='KNOWN_NATIVE_SOURCE_OBSERVED';
    }
  } catch(error) {
    blockers.push(error instanceof ManagementMigrationNativeInventoryError_?error.message:'MMI_OBSERVATION_UNAVAILABLE');
    result.knownSourceCoverageVerified=false;result.configurationSha256=null;result.writerState='UNKNOWN';
  }
  result.blockers=Array.from(new Set(blockers)).sort();
  // Safe logging is the only emitted output; this does not persist a migration observation or alter state.
  if(typeof Logger!=='undefined'&&typeof Logger.log==='function') Logger.log(JSON.stringify(result));
  return result;
}
