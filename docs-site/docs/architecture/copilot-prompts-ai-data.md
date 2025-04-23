# GitHub Copilot Prompts for Homelab AI & Data Processing

This guide provides example prompts for GitHub Copilot to assist with common AI and data processing tasks in a homelab environment.

## 1. Triton Inference Server Configuration and Optimization

Prompts for setting up, configuring, and optimizing NVIDIA Triton Inference Server.

1.  **Generate a basic Triton `config.pbtxt` for a TensorFlow SavedModel:**
    *   **Prompt:** `// Generate a Triton config.pbtxt for a TensorFlow SavedModel named 'my_model' with input tensor 'input__0' (dtype FP32, shape [-1, 224, 224, 3]) and output tensor 'output__0' (dtype FP32, shape [-1, 1000])`
    *   **Explanation:** Creates the basic configuration file needed by Triton to serve a TensorFlow model.
    *   **Customization:** Change model name, platform (`tensorflow_savedmodel`, `onnxruntime_onnx`, `pytorch_libtorch`, etc.), input/output tensor names, data types (e.g., `TYPE_FP32`, `TYPE_INT64`), and shapes. Use `-1` for variable batch size.

2.  **Create a Triton `config.pbtxt` with dynamic batching:**
    *   **Prompt:** `// Create a Triton config.pbtxt for an ONNX model 'image_classifier'. Enable dynamic batching with preferred batch sizes [4, 8, 16] and max queue delay of 100 microseconds.`
    *   **Explanation:** Configures Triton to automatically group inference requests into batches for better throughput.
    *   **Customization:** Adjust `preferred_batch_size`, `max_queue_delay_microseconds`.

3.  **Configure instance groups for multi-GPU deployment:**
    *   **Prompt:** `// Configure instance_group in Triton config.pbtxt to run 2 instances of the model 'resnet50' on GPU 0 and 1 instance on GPU 1.`
    *   **Explanation:** Specifies how many copies (instances) of the model should run and on which GPUs.
    *   **Customization:** Change the `count` and `gpus` list for each instance group entry.

4.  **Add model versioning policy:**
    *   **Prompt:** `// Add a version_policy to Triton config.pbtxt to serve only the latest 2 versions of the model.`
    *   **Explanation:** Controls which versions of a model Triton makes available for inference.
    *   **Customization:** Change the policy type (`latest`, `all`, `specific`) and the number of versions (`num_versions`).

5.  **Generate a Dockerfile for a custom Triton build with a backend:**
    *   **Prompt:** `// Create a Dockerfile based on the official Triton image 'nvcr.io/nvidia/tritonserver:23.10-py3' that adds the FasterTransformer backend.`
    *   **Explanation:** Useful if you need backends not included in the standard Triton image.
    *   **Customization:** Change the base image tag and the specific backend you need to add or build.

6.  **Write a Python script using `tritonclient` for inference:**
    *   **Prompt:** `// Python script using tritonclient http to send an image (numpy array) to a Triton server running model 'image_classifier' at localhost:8000.`
    *   **Explanation:** Generates client-side code to interact with the Triton server via HTTP/gRPC.
    *   **Customization:** Specify protocol (`http` or `grpc`), server address, model name, input/output tensor names, and data preparation logic.

## 2. Ray Cluster Setup and Resource Management

Prompts for configuring and managing Ray clusters for distributed computing.

1.  **Generate a basic Ray cluster YAML configuration:**
    *   **Prompt:** `// Generate a Ray cluster YAML file for a small homelab cluster with one head node and two worker nodes. Specify custom resources like 'GPU' and 'SSD'.`
    *   **Explanation:** Creates the configuration file used by the Ray cluster launcher.
    *   **Customization:** Adjust `min_workers`, `max_workers`, `head_node_type`, `worker_node_types`, `provider` (e.g., `local`, `aws`, `gcp`), and define custom resources.

2.  **Write a Python script to start a Ray head node programmatically:**
    *   **Prompt:** `// Python script using ray.init() to start a Ray head node, specifying the dashboard port and limiting object store memory to 2GB.`
    *   **Explanation:** Starts a Ray instance directly from Python, useful for single-node or testing setups.
    *   **Customization:** Change `dashboard_port`, `object_store_memory`, `num_cpus`, `num_gpus`.

3.  **Define a Ray actor with specific resource requirements:**
    *   **Prompt:** `// Define a Ray actor class 'DataProcessor' that requires 1 CPU and 0.5 GPU per instance.`
    *   **Explanation:** Creates a stateful Ray component (actor) and specifies its resource needs for scheduling.
    *   **Customization:** Adjust `@ray.remote(num_cpus=..., num_gpus=...)` decorators.

4.  **Create a Ray task function requesting custom resources:**
    *   **Prompt:** `// Define a Ray remote function 'process_batch' that requires a custom resource 'TPU' with a quantity of 1.`
    *   **Explanation:** Defines a stateless Ray task and specifies its resource requirements.
    *   **Customization:** Use `@ray.remote(resources={"resource_name": quantity})`.

5.  **Write a Python script to connect to an existing Ray cluster:**
    *   **Prompt:** `// Python script to connect to an existing Ray cluster using ray.init(address='auto').`
    *   **Explanation:** Connects a Python script as a driver to a running Ray cluster.
    *   **Customization:** Use `ray.init(address='ray://<head_node_ip>:<port>')` for specific addresses.

6.  **Implement a simple Ray Tune hyperparameter search:**
    *   **Prompt:** `// Python script using Ray Tune to perform a simple grid search over learning rates [0.01, 0.001] and batch sizes [32, 64] for a dummy training function.`
    *   **Explanation:** Sets up a basic hyperparameter optimization task using Ray Tune.
    *   **Customization:** Define the search space (`tune.grid_search`, `tune.choice`, etc.), the objective function, and the `tune.Tuner` configuration.

## 3. Model Conversion and Quantization Scripts

Prompts for converting model formats and applying quantization techniques.

1.  **Convert a TensorFlow SavedModel to ONNX:**
    *   **Prompt:** `// Python script using tf2onnx to convert a TensorFlow SavedModel located at './saved_model' to an ONNX file 'model.onnx' using opset 13.`
    *   **Explanation:** Generates code to perform model format conversion.
    *   **Customization:** Specify input/output paths, opset version, and potentially input signatures.

2.  **Convert a PyTorch model to ONNX:**
    *   **Prompt:** `// Python script using torch.onnx.export to convert a PyTorch model instance 'my_pytorch_model' to ONNX format 'model.onnx'. Use dynamic axes for batch size on input 'input_data'.`
    *   **Explanation:** Exports a PyTorch model to the ONNX standard.
    *   **Customization:** Provide a model instance, dummy input tensor matching the expected input shape, output path, `opset_version`, and `dynamic_axes` configuration.

3.  **Perform post-training static quantization on an ONNX model:**
    *   **Prompt:** `// Python script using ONNX Runtime quantization tools to perform post-training static quantization (INT8) on 'model.onnx'. Use a calibration data loader function 'get_calibration_data()'.`
    *   **Explanation:** Reduces model size and potentially speeds up inference by converting weights/activations to lower precision (INT8). Requires calibration data.
    *   **Customization:** Specify input/output model paths, the calibration data source (needs implementation), and quantization parameters (e.g., activation/weight types).

4.  **Perform post-training dynamic quantization on an ONNX model:**
    *   **Prompt:** `// Python script using ONNX Runtime quantization tools to perform post-training dynamic quantization on 'model.onnx', saving to 'model.dynamic_quant.onnx'.`
    *   **Explanation:** Simpler quantization method that doesn't require calibration data but quantizes weights statically and activations dynamically at runtime.
    *   **Customization:** Specify input/output model paths.

5.  **Convert an ONNX model to TensorFlow Lite:**
    *   **Prompt:** `// Python script using onnx-tf to convert 'model.onnx' to a TensorFlow SavedModel, then use TFLiteConverter to create 'model.tflite'.`
    *   **Explanation:** Multi-step process often needed for deploying models on edge devices.
    *   **Customization:** Specify input/output paths for intermediate and final models.

6.  **Apply INT8 quantization during TensorFlow Lite conversion:**
    *   **Prompt:** `// Modify the TFLiteConverter process to apply full integer quantization (INT8) using a representative dataset function 'representative_dataset_gen()'.`
    *   **Explanation:** Creates a quantized TFLite model suitable for integer-only hardware. Requires a representative dataset.
    *   **Customization:** Implement the `representative_dataset_gen` function to yield samples of your input data.

## 4. RabbitMQ Configuration and Message Handling

Prompts for setting up RabbitMQ exchanges, queues, and writing producers/consumers.

1.  **Generate `rabbitmq.conf` for basic settings:**
    *   **Prompt:** `// Generate a basic rabbitmq.conf file setting the default user/password to 'homelab/password' and enabling the management plugin.`
    *   **Explanation:** Creates a configuration file for the RabbitMQ server.
    *   **Customization:** Change credentials, ports, memory limits, etc. *Note: Use environment variables or proper secrets management for production.*

2.  **Write a Python Pika producer for a direct exchange:**
    *   **Prompt:** `// Python script using Pika library to connect to RabbitMQ at localhost, declare a direct exchange 'tasks_exchange', and publish a message 'Hello World' with routing key 'task_queue'.`
    *   **Explanation:** Sends messages to a specific queue via a direct exchange.
    *   **Customization:** Change connection parameters, exchange name, routing key, and message content/format (e.g., JSON).

3.  **Write a Python Pika consumer for a specific queue:**
    *   **Prompt:** `// Python script using Pika library to connect to RabbitMQ, declare a queue 'task_queue', bind it to 'tasks_exchange' with routing key 'task_queue', and consume messages with manual acknowledgments.`
    *   **Explanation:** Receives messages from a specific queue. Manual acknowledgment ensures messages aren't lost if the consumer crashes.
    *   **Customization:** Change connection parameters, queue/exchange names, routing key, and the message processing logic within the callback function. Remember to send `basic_ack`.

4.  **Configure a fanout exchange producer/consumer:**
    *   **Prompt:** `// Python Pika producer script for a fanout exchange 'logs_exchange'. // Python Pika consumer script that declares a temporary exclusive queue, binds it to 'logs_exchange', and consumes messages.`
    *   **Explanation:** Fanout exchanges broadcast messages to all bound queues, useful for logging or notifications. Consumers typically use temporary queues.
    *   **Customization:** Change exchange name, connection details. The consumer doesn't need a routing key for binding to a fanout exchange.

5.  **Set up message persistence and durable queues:**
    *   **Prompt:** `// Modify the Pika producer to publish persistent messages. // Modify the Pika consumer to declare a durable queue 'durable_task_queue'.`
    *   **Explanation:** Ensures messages are not lost if RabbitMQ restarts (persistence) and the queue itself survives restarts (durability).
    *   **Customization:** Set `pika.BasicProperties(delivery_mode=2)` in the producer. Set `durable=True` when declaring the queue in the consumer.

6.  **Implement a dead-letter exchange:**
    *   **Prompt:** `// Configure 'task_queue' using Pika queue_declare arguments to set up a dead-letter exchange 'dlx_exchange' with routing key 'dlx_key'. Messages rejected or TTL expired will go there.`
    *   **Explanation:** Routes messages that cannot be processed successfully to a separate exchange/queue for inspection or reprocessing.
    *   **Customization:** Specify `arguments={'x-dead-letter-exchange': 'dlx_exchange', 'x-dead-letter-routing-key': 'dlx_key'}` during `queue_declare`. You'll also need to declare the DLX exchange and a queue bound to it.

## 5. Data Transformation and Processing Pipelines

Prompts for creating scripts using Pandas, Dask, or Ray Data for data manipulation.

1.  **Read CSV data and perform basic cleaning with Pandas:**
    *   **Prompt:** `// Python script using Pandas to read 'data.csv', drop rows with missing values in the 'value' column, convert the 'timestamp' column to datetime objects, and filter rows where 'value' > 10.`
    *   **Explanation:** Common data loading and cleaning steps using Pandas DataFrames.
    *   **Customization:** Change file path, column names, cleaning logic (e.g., `fillna` instead of `dropna`), and filtering conditions.

2.  **Perform a group-by aggregation with Pandas:**
    *   **Prompt:** `// Using the Pandas DataFrame from the previous step, group by the 'category' column and calculate the mean and standard deviation of the 'value' column for each category.`
    *   **Explanation:** Aggregates data based on category labels.
    *   **Customization:** Change grouping columns and aggregation functions (`sum`, `count`, `max`, custom functions).

3.  **Read multiple CSV files and concatenate with Dask:**
    *   **Prompt:** `// Python script using Dask DataFrame to read all CSV files matching 'data_part_*.csv', assuming they have the same structure, into a single Dask DataFrame.`
    *   **Explanation:** Handles datasets larger than memory by reading and processing CSVs lazily and in parallel.
    *   **Customization:** Change the file pattern (`*.csv`, `data/??.csv`, etc.).

4.  **Perform a large-scale group-by aggregation with Dask:**
    *   **Prompt:** `// Using the Dask DataFrame 'ddf', group by 'user_id' and calculate the total 'amount_spent'. Compute the result.`
    *   **Explanation:** Performs distributed aggregations on large datasets. `compute()` triggers the actual calculation.
    *   **Customization:** Change grouping columns and aggregation logic.

5.  **Create a Ray Dataset from Pandas DataFrames:**
    *   **Prompt:** `// Python script using Ray Data to create a Ray Dataset from a list of Pandas DataFrames 'dfs'.`
    *   **Explanation:** Converts in-memory Pandas DataFrames into a distributed Ray Dataset.
    *   **Customization:** Use `ray.data.from_pandas(dfs)`.

6.  **Apply a transformation function to a Ray Dataset:**
    *   **Prompt:** `// Define a function 'normalize_column' that takes a batch (Pandas DataFrame) and normalizes the 'feature_1' column. Apply this function to a Ray Dataset 'ds' using map_batches.`
    *   **Explanation:** Applies a custom function in parallel across the blocks (batches) of a Ray Dataset. `map_batches` is generally preferred for efficiency.
    *   **Customization:** Implement the desired transformation logic within the function. Ensure it operates on and returns a Pandas DataFrame (or Arrow table depending on `batch_format`).

7.  **Shuffle and repartition a Ray Dataset:**
    *   **Prompt:** `// Shuffle the Ray Dataset 'ds' globally. Then, repartition it into 100 blocks.`
    *   **Explanation:** Randomizes data order (important for training) and controls the parallelism/granularity of the dataset.
    *   **Customization:** Adjust the number of partitions (`num_blocks`).

8.  **Read Parquet files into a Ray Dataset:**
    *   **Prompt:** `// Python script using Ray Data to read a directory of Parquet files './parquet_data' into a Ray Dataset.`
    *   **Explanation:** Efficiently reads data stored in the columnar Parquet format.
    *   **Customization:** Specify the path to the Parquet files/directory.
