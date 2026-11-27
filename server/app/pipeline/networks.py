"""madmom's neural networks, run by torch.

madmom convolves one input/output channel pair at a time with scipy — 8,192 calls for the chord network's last layer
alone — which made chord and key detection the longest step of a job. `run_on_torch` swaps each network in a madmom
processor chain for one running the same weights, from madmom's own model files, as whole-tensor torch operations, on
the GPU when there is one. Everything around the networks — spectrograms, padding, pooling, the chord CRF — stays
madmom's."""

from collections.abc import Callable

import numpy as np
import torch
import torch.nn.functional as F
from madmom.ml.nn import NeuralNetwork, activations
from madmom.ml.nn.layers import AverageLayer, BatchNormLayer, ConvolutionalLayer, MaxPoolLayer, PadLayer
from madmom.processors import SequentialProcessor

from app.pipeline.device import resolve_device

_Step = Callable[[torch.Tensor], torch.Tensor]

_ACTIVATIONS: dict[Callable, _Step] = {
    activations.linear: lambda x: x,
    activations.relu: F.relu,
    activations.elu: F.elu,
}


def _channel_parameter(values: np.ndarray, device: torch.device) -> torch.Tensor:
    # One value per channel, shaped to broadcast over (batch, channels, frames, bins).
    return torch.from_numpy(np.asarray(values, dtype=np.float32).reshape(-1, 1, 1)).to(device)


def _convolution(layer: ConvolutionalLayer, device: torch.device) -> _Step:
    # madmom's weights are (in, out, time, freq) and applied as a true convolution, which flips the kernel; conv2d
    # correlates. So: swap the channel axes and flip both kernel axes.
    weight = torch.from_numpy(np.asarray(layer.weights, dtype=np.float32)).transpose(0, 1).flip(2, 3).contiguous()
    weight = weight.to(device)
    bias = torch.from_numpy(np.broadcast_to(np.asarray(layer.bias, dtype=np.float32), weight.shape[:1]).copy())
    bias = bias.to(device)
    activation = _ACTIVATIONS[layer.activation_fn]
    return lambda x: activation(F.conv2d(x, weight, bias))


def _batch_norm(layer: BatchNormLayer, device: torch.device) -> _Step:
    mean = _channel_parameter(layer.mean, device)
    scale = _channel_parameter(layer.gamma * layer.inv_std, device)
    beta = _channel_parameter(layer.beta, device)
    activation = _ACTIVATIONS[layer.activation_fn]
    return lambda x: activation((x - mean) * scale + beta)


def _max_pool(layer: MaxPoolLayer) -> _Step:
    size, stride = tuple(layer.size), tuple(layer.stride)

    def pool(x: torch.Tensor) -> torch.Tensor:
        # madmom keeps scipy's maximum_filter output at size // 2 and then every stride: windows starting at multiples
        # of the stride, the last of which may run past the data, where the filter's constant mode reads zeros.
        lengths = x.shape[2:]
        counts = [len(range(s // 2, n, st)) for s, st, n in zip(size, stride, lengths)]
        overrun = [max(0, (c - 1) * st + s - n) for c, s, st, n in zip(counts, size, stride, lengths)]
        x = F.pad(x, (0, overrun[1], 0, overrun[0]))
        return F.max_pool2d(x, size, stride)[:, :, : counts[0], : counts[1]]

    return pool


def _pad(layer: PadLayer) -> _Step:
    # F.pad lists the last dimension first: bins, then frames.
    widths = [0, 0, 0, 0]
    for axis in layer.axes:
        if axis not in (0, 1):
            raise NotImplementedError(f"padding madmom axis {axis}")
        first = 0 if axis == 1 else 2
        widths[first] = widths[first + 1] = layer.width
    value = float(layer.value)
    return lambda x: F.pad(x, tuple(widths), value=value)


def _average(layer: AverageLayer) -> _Step:
    axes = layer.axis if isinstance(layer.axis, tuple) else (layer.axis,)
    if set(axes) != {0, 1} or layer.keepdims:
        raise NotImplementedError(f"averaging madmom axes {layer.axis}")
    # Over frames and bins: what remains is one value per channel.
    return lambda x: x.mean(dim=(2, 3))


def _convert(layer: object, device: torch.device) -> _Step:
    if isinstance(layer, ConvolutionalLayer):
        return _convolution(layer, device)
    if isinstance(layer, BatchNormLayer):
        return _batch_norm(layer, device)
    if isinstance(layer, MaxPoolLayer):
        return _max_pool(layer)
    if isinstance(layer, PadLayer):
        return _pad(layer)
    if isinstance(layer, AverageLayer):
        return _average(layer)
    raise NotImplementedError(f"madmom layer {type(layer).__name__}")


class TorchNetwork:
    """A madmom NeuralNetwork made of the layers `_convert` knows, run by torch on `device`. Takes and returns what
    `NeuralNetwork.process` does: (frames, bins) or (frames, bins, channels) in, numpy out, in madmom's layout."""

    def __init__(self, network: NeuralNetwork, device: torch.device):
        self._device = device
        self._steps = [_convert(layer, device) for layer in network.layers]

    def __call__(self, data: np.ndarray) -> np.ndarray:
        x = torch.from_numpy(np.asarray(data, dtype=np.float32)).to(self._device)
        # madmom's layout is (frames, bins, channels) and torch's (batch, channels, frames, bins). A 2-D input is one
        # channel, as madmom's first convolution reads it.
        x = x[None, None] if x.ndim == 2 else x.permute(2, 0, 1)[None]
        with torch.inference_mode():
            for step in self._steps:
                x = step(x)
            x = x[0]
            # Contiguous: madmom's segment_axis, which reads the chord network's output, assumes it.
            x = x.permute(1, 2, 0) if x.ndim == 3 else x
            return x.contiguous().cpu().numpy()


def run_on_torch(processor: SequentialProcessor) -> SequentialProcessor:
    """Swaps every NeuralNetwork in a madmom processor chain — ensembles included, which are chains themselves — for
    a TorchNetwork on the resolved device, in place, and returns the chain."""
    for index, step in enumerate(processor.processors):
        if isinstance(step, NeuralNetwork):
            processor.processors[index] = TorchNetwork(step, resolve_device())
        elif isinstance(step, SequentialProcessor):
            run_on_torch(step)
    return processor
