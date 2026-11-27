import functools
import logging

import torch

from app.core.config import settings

logger = logging.getLogger(__name__)


@functools.cache
def resolve_device() -> torch.device:
    """The device every model runs on: the configured one, or the CPU when CUDA was asked for and torch can't use it.
    Settles, once, the process-wide torch state the models share."""
    # Full float32 convolutions where cuDNN would round them through TF32 (Ampere and newer). madmom's chord and key
    # networks then match madmom to float precision rather than to about 1e-4, which near a tie could flip a chord;
    # Demucs measured no slower for it (139 against 142 ms a chunk on an RTX 4060).
    torch.backends.cudnn.allow_tf32 = False
    device = torch.device(settings.device)
    if device.type == "cuda" and not torch.cuda.is_available():
        # Said once, loudly: a GPU build whose CUDA runtime is newer than the host's driver lands here, and every job
        # then runs on the CPU, tens of times slower, with nothing else to show why.
        logger.warning("DEVICE is %s, but torch %s can't use CUDA here; running on the CPU", device, torch.__version__)
        return torch.device("cpu")
    logger.info("Models run on %s", torch.cuda.get_device_name(device) if device.type == "cuda" else device)
    return device
