import tflite
import sys
with open('assets/best.tflite', 'rb') as f:
    model = tflite.Model.GetRootAsModel(f.read(), 0)
    subgraph = model.Subgraphs(0)
    print('INPUTS:')
    for i in range(subgraph.InputsLength()):
        tensor = subgraph.Tensors(subgraph.Inputs(i))
        print(f' - {tensor.Name().decode()}: shape={tensor.ShapeAsNumpy()}')
    print('OUTPUTS:')
    for i in range(subgraph.OutputsLength()):
        tensor = subgraph.Tensors(subgraph.Outputs(i))
        print(f' - {tensor.Name().decode()}: shape={tensor.ShapeAsNumpy()}')
