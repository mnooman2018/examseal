// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IExamSealRegistry } from "./IExamSealRegistry.sol";

/// @title ExamSealRegistry
/// @notice Tamper-evident, threshold-released exam papers. Stores commitments, publishes
///         encrypted per-centre copies as events, and only accepts custodian key pieces
///         at or after the exam's release time (chain time).
/// @dev No upgradeability, no token, no payable functions, no global admin, no external calls.
contract ExamSealRegistry is IExamSealRegistry {
    uint8 private constant SKIP_COMPROMISED = 1;
    uint8 private constant SKIP_DUPLICATE = 2;
    uint8 private constant SKIP_UNKNOWN_CENTRE = 3;
    uint8 private constant SKIP_BAD_LENGTH = 4;

    uint256 private constant MAX_CUSTODIANS = 10;
    uint256 private constant MIN_SHARE_LENGTH = 48;
    uint256 private constant MAX_SHARE_LENGTH = 256;

    uint256 public override nextExamId = 1;

    mapping(uint256 => ExamView) private _exams;
    mapping(uint256 => mapping(address => bool)) private _isCustodian;
    mapping(uint256 => mapping(uint32 => CentreView)) private _centres;
    mapping(uint256 => uint32[]) private _centreIds;
    mapping(uint256 => mapping(uint32 => mapping(address => bytes))) private _shares;

    // ------------------------------------------------------------------ modifiers

    modifier examExists(uint256 examId) {
        if (_exams[examId].authority == address(0)) revert ExamNotFound();
        _;
    }

    modifier onlyAuthority(uint256 examId) {
        if (_exams[examId].authority == address(0)) revert ExamNotFound();
        if (msg.sender != _exams[examId].authority) revert NotAuthority();
        _;
    }

    // ------------------------------------------------------------------ writes

    function createExam(
        string calldata title,
        bytes32 paperCommitment,
        uint64 releaseTime,
        uint64 revealTime,
        address[] calldata custodians,
        uint8 threshold
    ) external returns (uint256 examId) {
        uint256 n = custodians.length;
        if (n > MAX_CUSTODIANS) revert BadCustodians();
        if (threshold < 2 || threshold > n) revert BadThreshold();
        if (releaseTime <= block.timestamp || revealTime < releaseTime) revert BadTimes();

        examId = nextExamId++;

        for (uint256 i = 0; i < n; i++) {
            address c = custodians[i];
            if (c == address(0) || _isCustodian[examId][c]) revert BadCustodians();
            _isCustodian[examId][c] = true;
        }

        ExamView storage e = _exams[examId];
        e.authority = msg.sender;
        e.title = title;
        e.paperCommitment = paperCommitment;
        e.releaseTime = releaseTime;
        e.revealTime = revealTime;
        e.threshold = threshold;
        e.createdBlock = uint64(block.number);
        e.custodians = custodians;

        emit ExamCreated(examId, msg.sender, title, paperCommitment, releaseTime, revealTime, threshold, custodians);
    }

    function registerCentres(
        uint256 examId,
        uint32[] calldata centreIds,
        bytes32[] calldata encPubKeys,
        bytes32[] calldata fingerprintCommitments,
        bytes[] calldata variantCiphertexts
    ) external onlyAuthority(examId) {
        ExamView storage e = _exams[examId];
        if (block.timestamp >= e.releaseTime) revert RegistrationClosed();

        uint256 n = centreIds.length;
        if (encPubKeys.length != n || fingerprintCommitments.length != n || variantCiphertexts.length != n) {
            revert LengthMismatch();
        }

        for (uint256 i = 0; i < n; i++) {
            _registerCentre(examId, centreIds[i], encPubKeys[i], fingerprintCommitments[i], variantCiphertexts[i]);
        }

        e.centreCount += uint32(n);
    }

    function _registerCentre(
        uint256 examId,
        uint32 centreId,
        bytes32 encPubKey,
        bytes32 fingerprintCommitment,
        bytes calldata ciphertext
    ) private {
        CentreView storage c = _centres[examId][centreId];
        if (c.status != CentreStatus.None) revert CentreExists();
        if (encPubKey == bytes32(0)) revert BadPubKey();

        bytes32 variantCommitment = keccak256(ciphertext);

        c.status = CentreStatus.Sealed;
        c.encPubKey = encPubKey;
        c.variantCommitment = variantCommitment;
        c.fingerprintCommitment = fingerprintCommitment;
        c.registeredBlock = uint64(block.number);

        _centreIds[examId].push(centreId);

        emit CentreRegistered(examId, centreId, encPubKey, variantCommitment, fingerprintCommitment);
        emit EncryptedVariantPublished(examId, centreId, ciphertext);
    }

    function releaseShares(uint256 examId, uint32[] calldata centreIds, bytes[] calldata sealedShares)
        external
        examExists(examId)
    {
        ExamView storage e = _exams[examId];
        if (!_isCustodian[examId][msg.sender]) revert NotCustodian();
        if (block.timestamp < e.releaseTime) {
            revert ReleaseNotStarted(e.releaseTime, uint64(block.timestamp));
        }
        if (sealedShares.length != centreIds.length) revert LengthMismatch();

        uint8 threshold = e.threshold;

        for (uint256 i = 0; i < centreIds.length; i++) {
            uint32 centreId = centreIds[i];
            CentreView storage c = _centres[examId][centreId];

            if (c.status == CentreStatus.None) {
                emit ShareSkipped(examId, centreId, msg.sender, SKIP_UNKNOWN_CENTRE);
                continue;
            }
            if (c.status == CentreStatus.Compromised) {
                emit ShareSkipped(examId, centreId, msg.sender, SKIP_COMPROMISED);
                continue;
            }
            if (_shares[examId][centreId][msg.sender].length != 0) {
                emit ShareSkipped(examId, centreId, msg.sender, SKIP_DUPLICATE);
                continue;
            }
            uint256 len = sealedShares[i].length;
            if (len < MIN_SHARE_LENGTH || len > MAX_SHARE_LENGTH) {
                emit ShareSkipped(examId, centreId, msg.sender, SKIP_BAD_LENGTH);
                continue;
            }

            _shares[examId][centreId][msg.sender] = sealedShares[i];
            uint8 approvals = c.approvals + 1;
            c.approvals = approvals;

            emit ShareReleased(examId, centreId, msg.sender, sealedShares[i], approvals);

            if (approvals == threshold) {
                c.status = CentreStatus.Released;
                emit ReleaseAuthorized(examId, centreId, uint64(block.timestamp));
            }
        }
    }

    function recordLeak(uint256 examId, uint32 centreId, bytes32 evidenceHash, uint16 matched, uint16 observed)
        external
        onlyAuthority(examId)
    {
        CentreView storage c = _centres[examId][centreId];
        if (c.status == CentreStatus.None) revert CentreNotFound();
        c.lastEvidenceHash = evidenceHash;
        emit LeakRecorded(examId, centreId, evidenceHash, matched, observed);
    }

    /// @dev Idempotent: revoking an already compromised centre succeeds and re-emits.
    function revokeCentre(uint256 examId, uint32 centreId, bytes32 reasonHash) external onlyAuthority(examId) {
        CentreView storage c = _centres[examId][centreId];
        if (c.status == CentreStatus.None) revert CentreNotFound();
        c.status = CentreStatus.Compromised;
        emit CentreRevoked(examId, centreId, reasonHash);
    }

    function revealFingerprint(uint256 examId, uint32 centreId, bytes calldata fingerprint, bytes32 salt)
        external
        examExists(examId)
    {
        ExamView storage e = _exams[examId];
        CentreView storage c = _centres[examId][centreId];
        if (c.status == CentreStatus.None) revert CentreNotFound();
        if (block.timestamp < e.revealTime) revert RevealNotStarted(e.revealTime, uint64(block.timestamp));
        if (c.fingerprintRevealed) revert AlreadyRevealed();
        if (keccak256(abi.encode(examId, centreId, fingerprint, salt)) != c.fingerprintCommitment) {
            revert CommitmentMismatch();
        }
        c.fingerprintRevealed = true;
        emit FingerprintRevealed(examId, centreId, fingerprint);
    }

    // ------------------------------------------------------------------ views

    function getExam(uint256 examId) external view examExists(examId) returns (ExamView memory) {
        return _exams[examId];
    }

    function getCentre(uint256 examId, uint32 centreId) external view examExists(examId) returns (CentreView memory) {
        CentreView memory c = _centres[examId][centreId];
        if (c.status == CentreStatus.None) revert CentreNotFound();
        return c;
    }

    function getCentreIds(uint256 examId) external view examExists(examId) returns (uint32[] memory) {
        return _centreIds[examId];
    }

    /// @notice Returns every custodian in piece order with their sealed share (empty bytes if not released).
    function getShares(uint256 examId, uint32 centreId)
        external
        view
        examExists(examId)
        returns (address[] memory custodians, bytes[] memory sealedShares)
    {
        if (_centres[examId][centreId].status == CentreStatus.None) revert CentreNotFound();
        custodians = _exams[examId].custodians;
        sealedShares = new bytes[](custodians.length);
        for (uint256 i = 0; i < custodians.length; i++) {
            sealedShares[i] = _shares[examId][centreId][custodians[i]];
        }
    }

    function hasReleased(uint256 examId, uint32 centreId, address custodian) external view returns (bool) {
        return _shares[examId][centreId][custodian].length != 0;
    }
}
